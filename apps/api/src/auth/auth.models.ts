import { Field, ID, InputType, ObjectType } from "@nestjs/graphql";

@ObjectType("User")
export class UserModel {
  @Field(() => ID) id!: string;
  @Field(() => String) email!: string;
  @Field(() => String, { description: "Fecha ISO 8601 de creación de la cuenta." }) createdAt!: string;
}

@ObjectType("AuthPayload", {
  description: "Sesión iniciada. El refresh token viaja sólo en la cookie HttpOnly `cancha_refresh`, nunca en el cuerpo.",
})
export class AuthPayloadModel {
  @Field(() => String, { description: "JWT de 15 minutos: envíalo como `Authorization: Bearer <token>`." })
  accessToken!: string;
  @Field(() => String, { description: "Fecha ISO 8601 en que vence el access token." }) accessTokenExpiresAt!: string;
  @Field(() => UserModel) user!: UserModel;
}

@InputType()
export class CredentialsInput {
  @Field(() => String) email!: string;
  @Field(() => String) password!: string;
}
