import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Database } from "./database";
import { loginSchema, registerSchema, parse } from "./validation";
import { userView } from "./projections";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
@Injectable()
export class AuthService {
  private jwt: JwtService;
  constructor(private db: Database) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32)
      throw new Error("请配置至少 32 字符的 JWT_SECRET");
    this.jwt = new JwtService({
      secret,
      signOptions: {
        expiresIn: "15m",
        issuer: "campus-market",
        audience: "campus-market-web",
      },
    });
  }
  async authenticate(
    req: Request,
    optional = false,
  ): Promise<string | undefined> {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token && optional) return undefined;
    try {
      const payload = await this.jwt.verifyAsync(token!, {
        issuer: "campus-market",
        audience: "campus-market-web",
        algorithms: ["HS256"],
      });
      const result = await this.db.query(
        "SELECT user_id FROM sessions WHERE id=$1 AND user_id=$2 AND expires_at>now()",
        [payload.sid, payload.sub],
      );
      if (!result.rows.length) throw new Error();
      return payload.sub;
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }
  private cookie(res: Response, token: string) {
    res.cookie("cm_refresh", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/v1/auth",
      maxAge: 7 * 86400000,
    });
  }
  private async session(user: any, res: Response) {
    const sid = randomUUID(),
      refresh = randomBytes(32).toString("hex");
    await this.db.query(
      "INSERT INTO sessions(id,user_id,refresh_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [sid, user.id, digest(refresh)],
    );
    this.cookie(res, `${sid}.${refresh}`);
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, sid }),
      expiresAtIso: new Date(Date.now() + 15 * 60000).toISOString(),
      user: userView(user, true),
    };
  }
  async register(input: unknown, res: Response) {
    const v = parse(registerSchema, input);
    const { rows } = await this.db.query(
      "INSERT INTO users(id,account,password_hash,nickname,campus,contact) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        randomUUID(),
        v.account,
        await hash(v.password, 12),
        v.nickname,
        v.campus,
        v.contact,
      ],
    );
    return this.session(rows[0], res);
  }
  async login(input: unknown, res: Response) {
    const v = parse(loginSchema, input);
    const { rows } = await this.db.query(
      "SELECT * FROM users WHERE account=$1",
      [v.account],
    );
    // Always perform a password hash comparison, including unknown accounts.
    const valid = await compare(
      v.password,
      rows[0]?.password_hash ??
        "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5JYlD9wzFj4z7KjwxP4g1Tf51EYxf3a",
    );
    if (!rows[0] || !valid) throw new UnauthorizedException("账号或密码错误");
    return this.session(rows[0], res);
  }
  private checkOrigin(req: Request) {
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    )
      throw new ForbiddenException("来源不允许");
  }
  async refresh(req: Request, res: Response) {
    this.checkOrigin(req);
    const [sid, token] = (req.cookies?.cm_refresh ?? "").split(".");
    if (!/^[0-9a-f-]{36}$/.test(sid ?? "") || !token)
      throw new UnauthorizedException("请重新登录");
    const replacement = randomBytes(32).toString("hex");
    const user = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        "UPDATE sessions SET refresh_hash=$1 WHERE id=$2 AND refresh_hash=$3 AND expires_at>now() RETURNING user_id",
        [digest(replacement), sid, digest(token)],
      );
      if (!rows.length) throw new UnauthorizedException("会话已过期");
      return (
        await tx.query("SELECT * FROM users WHERE id=$1", [rows[0].user_id])
      ).rows[0];
    });
    this.cookie(res, `${sid}.${replacement}`);
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, sid }),
      expiresAtIso: new Date(Date.now() + 15 * 60000).toISOString(),
      user: userView(user, true),
    };
  }
  async logout(req: Request, res: Response) {
    this.checkOrigin(req);
    const [sid, token] = (req.cookies?.cm_refresh ?? "").split(".");
    if (/^[0-9a-f-]{36}$/.test(sid ?? "") && token)
      await this.db.query(
        "DELETE FROM sessions WHERE id=$1 AND refresh_hash=$2",
        [sid, digest(token)],
      );
    res.clearCookie("cm_refresh", {
      path: "/v1/auth",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
  }
}
