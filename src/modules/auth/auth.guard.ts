import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '../jwt/jwt.service';
import { PrismaService } from '../database/prisma.service';

// types
import type { JwtPayload } from 'jsonwebtoken';
import { EXCEPTION_CODE } from '../../constants/exception.code';
import { subMinutes } from 'date-fns';

interface Payload {
  authId: number;
  userId: number;
  address: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (['/api/v1/auth/logout'].includes(request.url)) {
      return true;
    }

    let accessToken: string | undefined = request.cookies?.access_token;

    const { authorization } = request.headers;

    // 토큰은 존재하지 않지만 헤더값에 authorization가 존재하는 경우
    // authorization에서 토큰이 존재하는 체크
    if (!accessToken && authorization) {
      accessToken = authorization.split(' ')[1];
    }

    if (accessToken) {
      // 토큰이 존재하는 경우
      let accessTokenData: (JwtPayload & Payload) | null = null;
      try {
        // 토큰을 통해서 유저 정보를 가져온다.
        accessTokenData = await this.jwt.verify<Payload>(accessToken);
      } catch (error) {
        // 토큰이 유효하지 않은 경우
        accessTokenData = null;
      }

      if (accessTokenData && accessTokenData.authId) {
        // access token is valid expire date diff is less than 7 days
        const diff =
          new Date(accessTokenData.exp * 1000).getTime() - Date.now();
        if (diff > 0) {
          const validated = await this.prisma.userAuthentication.findUnique({
            where: {
              id: accessTokenData.authId,
            },
          });

          if (!validated) {
            throw new UnauthorizedException({
              status: EXCEPTION_CODE.INVALID_TOKEN,
              message: ['유효하지않는 토큰입니다.'],
              error: 'Invalid Token',
            });
          }

          // 만료일이 7일을 넘어가는 경우
          if (validated.expiresAt.getTime() - Date.now() < 0) {
            throw new UnauthorizedException({
              status: EXCEPTION_CODE.INVALID_TOKEN,
              message: ['유효하지않는 토큰입니다.'],
              error: 'Invalid Token',
            });
          }

          // 최대 5분에 한 번 확인
          const user = await this.prisma.user.findUnique({
            where: {
              id: accessTokenData.userId,
            },
            select: {
              id: true,
              email: true,
              username: true,
              profile: {
                select: {
                  name: true,
                  bio: true,
                  avatarUrl: true,
                  availableText: true,
                  location: true,
                  website: true,
                  profileOnTechStacks: {
                    select: {
                      techStack: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          });

          if (!user) {
            throw new UnauthorizedException({
              status: EXCEPTION_CODE.INVALID_TOKEN,
              message: ['유효하지않는 토큰입니다.'],
              error: 'Invalid Token',
            });
          }

          if (validated.lastValidatedAt > subMinutes(Date.now(), 5)) {
            // 마지막으로 확인할 때 db에 씁니다.
            await this.prisma.userAuthentication.update({
              where: {
                id: accessTokenData.authId,
              },
              data: {
                lastValidatedAt: new Date(),
              },
            });
          }

          request.user = user;
          return true;
        } else {
          // 401 Unauthorized
          throw new UnauthorizedException({
            status: EXCEPTION_CODE.TOKEN_EXPIRED,
            message: ['만료된 토큰입니다.'],
            error: 'Token Expired',
          });
        }
      } else {
        // 401 Unauthorized
        throw new UnauthorizedException({
          status: EXCEPTION_CODE.INVALID_TOKEN,
          message: ['유효하지않는 토큰입니다.'],
          error: 'Invalid Token',
        });
      }
    }

    return true;
  }
}
