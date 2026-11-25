import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Db, Document } from "mongodb";
import { MONGO_DATABASE } from "../database/database.tokens.js";
import { LibraryUnitOfWork } from "../library/library-unit-of-work.js";
import { toTournamentModel } from "../graphql/tournament-mapper.js";

const collectionName = "tournament_shares";
interface TournamentShareDocument extends Document {
  _id: string;
  userId: string;
  tournamentId: string;
  createdAt: Date;
}
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

@Injectable()
export class TournamentSharesService {
  constructor(@Inject(MONGO_DATABASE) private readonly db: Db, private readonly unitOfWork: LibraryUnitOfWork) {}

  async create(userId: string, tournamentId: string): Promise<{ token: string; tournamentId: string }> {
    const run = await this.unitOfWork.read(userId, repository => repository.findAll().find(item => item.id === tournamentId));
    if (!run.result) throw new Error("No se encontró el torneo.");
    const token = randomBytes(32).toString("base64url");
    await this.db.collection<TournamentShareDocument>(collectionName).insertOne({ _id: digest(token), userId, tournamentId, createdAt: new Date() });
    return { token, tournamentId: run.result.id };
  }

  async revoke(userId: string, token: string): Promise<boolean> {
    const result = await this.db.collection<TournamentShareDocument>(collectionName).deleteOne({ _id: digest(token), userId });
    return result.deletedCount === 1;
  }

  async revokeForTournament(userId: string, tournamentId: string): Promise<boolean> {
    const result = await this.db.collection<TournamentShareDocument>(collectionName).deleteMany({ userId, tournamentId });
    return result.deletedCount > 0;
  }

  async read(token: string): Promise<unknown | null> {
    const share = await this.db.collection<TournamentShareDocument>(collectionName).findOne({ _id: digest(token) });
    if (!share || typeof share.userId !== "string" || typeof share.tournamentId !== "string") return null;
    try {
      const run = await this.unitOfWork.read(share.userId, repository => repository.findAll().find(item => item.id === share.tournamentId));
      return run.result ? toTournamentModel(run.result, 0, []) : null;
    } catch { return null; }
  }
}
