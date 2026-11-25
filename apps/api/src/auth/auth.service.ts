import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import argon2 from "argon2";
import { MongoServerError, type ClientSession, type Collection, type Db, type MongoClient } from "mongodb";
import type { ApiEnvironment } from "../config/env.validation.js";
import { MONGO_CLIENT, MONGO_DATABASE } from "../database/database.tokens.js";
import { AuthenticationError, invalidCredentialsMessage } from "./auth.errors.js";
import { maximumPasswordLength, normalizeEmail, validateRegistration } from "./credentials.js";

export const authCollectionNames = {
  users: "users",
  sessions: "sessions",
  refreshTokens: "refresh_tokens",
} as const;

/** Vida del access token: 15 minutos. */
export const accessTokenTtlSeconds = 15 * 60;
const duplicateKeyCode = 11000;
const dayMs = 24 * 60 * 60 * 1000;

interface UserDocument { _id: string; email: string; passwordHash: string; createdAt: Date }

/** Una sesión es una familia de refresh tokens nacida en un login o registro. */
interface SessionDocument {
  _id: string;
  userId: string;
  createdAt: Date;
  /** Vence con el último refresh token emitido (se extiende en cada rotación). */
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason?: "logout" | "reuse";
}

/** Refresh token de un solo uso: sólo se guarda el hash SHA-256 de su secreto. */
interface RefreshTokenDocument {
  _id: string;
  familyId: string;
  userId: string;
  hash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  replacedBy: string | null;
  revokedAt: Date | null;
}

export interface AuthUser { readonly id: string; readonly email: string; readonly createdAt: Date }

/** Lo que el guard deja en la petición: el usuario y la sesión del access token. */
export interface SessionUser { readonly id: string; readonly sessionId: string }

export interface IssuedSession {
  readonly user: AuthUser;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

interface AccessTokenPayload { sub: string; sid: string }

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `tokenId.secreto`: el id permite buscar el documento y el secreto se compara por hash. */
function parseRefreshToken(token: string | undefined): { id: string; secret: string } | undefined {
  if (!token) return undefined;
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return undefined;
  return { id: token.slice(0, separator), secret: token.slice(separator + 1) };
}

function toUser(document: UserDocument): AuthUser {
  return { id: document._id, email: document.email, createdAt: document.createdAt };
}

/**
 * Cuentas y sesiones. Access token JWT HS256 de 15 min con `sub` (usuario) y
 * `sid` (sesión); refresh token rotativo de un solo uso, guardado como hash.
 * Reutilizar un refresh ya usado se trata como robo y revoca su familia (la
 * sesión completa), con lo que también deja de valer su access token.
 */
@Injectable()
export class AuthService {
  private readonly users: Collection<UserDocument>;
  private readonly sessions: Collection<SessionDocument>;
  private readonly refreshTokens: Collection<RefreshTokenDocument>;
  private indexes?: Promise<void>;
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(MONGO_DATABASE) private readonly database: Db,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
  ) {
    this.users = database.collection(authCollectionNames.users);
    this.sessions = database.collection(authCollectionNames.sessions);
    this.refreshTokens = database.collection(authCollectionNames.refreshTokens);
  }

  /** Índices de autenticación. Idempotente; el email único es la garantía contra registros duplicados. */
  static async ensureIndexes(database: Db): Promise<void> {
    await database.collection(authCollectionNames.users).createIndexes([
      { key: { email: 1 }, name: "email_unique", unique: true },
    ]);
    await database.collection(authCollectionNames.sessions).createIndexes([
      { key: { userId: 1 }, name: "user" },
      { key: { expiresAt: 1 }, name: "expires_ttl", expireAfterSeconds: 0 },
    ]);
    await database.collection(authCollectionNames.refreshTokens).createIndexes([
      { key: { familyId: 1 }, name: "family" },
      { key: { expiresAt: 1 }, name: "expires_ttl", expireAfterSeconds: 0 },
    ]);
  }

  async register(email: string, password: string): Promise<IssuedSession> {
    const normalized = validateRegistration(email, password);
    await this.ensureIndexes();
    const user: UserDocument = {
      _id: randomUUID(),
      email: normalized,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      createdAt: new Date(),
    };
    try {
      await this.users.insertOne(user);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === duplicateKeyCode) {
        throw new DomainError("Ya existe una cuenta con ese email.");
      }
      throw error;
    }
    return this.startSession(user);
  }

  /** Mismo mensaje y mismo trabajo (argon2) exista o no el email. */
  async login(email: string, password: string): Promise<IssuedSession> {
    await this.ensureIndexes();
    const user = await this.users.findOne({ email: normalizeEmail(email) });
    const usable = typeof password === "string" && [...password].length <= maximumPasswordLength;
    const hash = user?.passwordHash ?? await this.timingHash();
    const valid = usable && await argon2.verify(hash, password).catch(() => false);
    if (!user || !valid) throw new AuthenticationError(invalidCredentialsMessage);
    return this.startSession(user);
  }

  /** Rota el refresh token: el usado queda marcado y nace uno nuevo en la misma familia. */
  async refresh(token: string | undefined): Promise<IssuedSession> {
    const parsed = parseRefreshToken(token);
    if (!parsed) throw new AuthenticationError("La sesión expiró. Inicia sesión nuevamente.");
    await this.ensureIndexes();
    const outcome = await this.transaction(async session => {
      const now = new Date();
      const current = await this.refreshTokens.findOne({ _id: parsed.id }, { session });
      if (!current || !sameHash(current.hash, hashSecret(parsed.secret))) return { kind: "invalid" as const };
      const family = await this.sessions.findOne({ _id: current.familyId }, { session });
      if (!family || family.revokedAt || current.revokedAt) return { kind: "invalid" as const };
      if (current.usedAt) {
        await this.revokeFamily(current.familyId, "reuse", now, session);
        return { kind: "reused" as const };
      }
      if (current.expiresAt <= now || family.expiresAt <= now) return { kind: "invalid" as const };
      const user = await this.users.findOne({ _id: current.userId }, { session });
      if (!user) return { kind: "invalid" as const };
      const next = this.newRefreshToken(user._id, current.familyId, now);
      const marked = await this.refreshTokens.updateOne(
        { _id: current._id, usedAt: null, revokedAt: null },
        { $set: { usedAt: now, replacedBy: next.document._id } },
        { session },
      );
      if (marked.matchedCount === 0) {
        await this.revokeFamily(current.familyId, "reuse", now, session);
        return { kind: "reused" as const };
      }
      await this.refreshTokens.insertOne(next.document, { session });
      await this.sessions.updateOne({ _id: current.familyId }, { $set: { expiresAt: next.document.expiresAt } }, { session });
      return { kind: "rotated" as const, user, next };
    });
    if (outcome.kind === "reused") {
      throw new AuthenticationError("Se detectó la reutilización de una sesión cerrada. Inicia sesión nuevamente.");
    }
    if (outcome.kind === "invalid") throw new AuthenticationError("La sesión expiró. Inicia sesión nuevamente.");
    return this.issue(outcome.user, outcome.next.document.familyId, outcome.next.token, outcome.next.document.expiresAt);
  }

  /** Revoca la sesión del access token y todos sus refresh tokens. */
  async logout(sessionId: string): Promise<void> {
    await this.transaction(session => this.revokeFamily(sessionId, "logout", new Date(), session));
  }

  /** Verifica firma, vencimiento y que la sesión siga activa. */
  async authenticate(accessToken: string | undefined): Promise<SessionUser> {
    if (!accessToken) throw new AuthenticationError();
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(accessToken, { algorithms: ["HS256"] });
    } catch {
      throw new AuthenticationError("La sesión no es válida o expiró.");
    }
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      throw new AuthenticationError("La sesión no es válida o expiró.");
    }
    const active = await this.sessions.findOne(
      { _id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { $gt: new Date() } },
      { projection: { _id: 1 } },
    );
    if (!active) throw new AuthenticationError("La sesión fue cerrada. Inicia sesión nuevamente.");
    return { id: payload.sub, sessionId: payload.sid };
  }

  async findUser(id: string): Promise<AuthUser> {
    const user = await this.users.findOne({ _id: id });
    if (!user) throw new AuthenticationError();
    return toUser(user);
  }

  private async startSession(user: UserDocument): Promise<IssuedSession> {
    const now = new Date();
    const familyId = randomUUID();
    const refresh = this.newRefreshToken(user._id, familyId, now);
    await this.transaction(async session => {
      await this.sessions.insertOne({
        _id: familyId, userId: user._id, createdAt: now, expiresAt: refresh.document.expiresAt, revokedAt: null,
      }, { session });
      await this.refreshTokens.insertOne(refresh.document, { session });
    });
    return this.issue(user, familyId, refresh.token, refresh.document.expiresAt);
  }

  private async issue(user: UserDocument, familyId: string, refreshToken: string, refreshTokenExpiresAt: Date): Promise<IssuedSession> {
    const payload: AccessTokenPayload = { sub: user._id, sid: familyId };
    const accessToken = await this.jwt.signAsync(payload, { algorithm: "HS256", expiresIn: accessTokenTtlSeconds });
    return {
      user: toUser(user),
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + accessTokenTtlSeconds * 1000),
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  private newRefreshToken(userId: string, familyId: string, now: Date) {
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const document: RefreshTokenDocument = {
      _id: id,
      familyId,
      userId,
      hash: hashSecret(secret),
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.get("REFRESH_TOKEN_TTL_DAYS", { infer: true }) * dayMs),
      usedAt: null,
      replacedBy: null,
      revokedAt: null,
    };
    return { token: `${id}.${secret}`, document };
  }

  private async revokeFamily(familyId: string, reason: "logout" | "reuse", now: Date, session: ClientSession): Promise<void> {
    await this.sessions.updateOne(
      { _id: familyId, revokedAt: null },
      { $set: { revokedAt: now, revokedReason: reason } },
      { session },
    );
    await this.refreshTokens.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: now } }, { session });
  }

  /** Hash ficticio para que un email inexistente cueste lo mismo que una contraseña incorrecta. */
  private timingHash(): Promise<string> {
    this.dummyHash ??= argon2.hash(randomBytes(32).toString("base64url"), { type: argon2.argon2id });
    return this.dummyHash;
  }

  /** Se crean antes del primer uso: la unicidad del email no depende de un arranque asíncrono. */
  private ensureIndexes(): Promise<void> {
    this.indexes ??= AuthService.ensureIndexes(this.database).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    return this.indexes;
  }

  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.client.withSession(session => session.withTransaction(() => work(session), {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      readPreference: "primary",
    }));
  }
}
import { DomainError } from "@cancha/core/domain/domain-error";
