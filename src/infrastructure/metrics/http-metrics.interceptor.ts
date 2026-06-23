import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      route?: { path?: string };
      path: string;
    }>();
    const method = request.method;
    const route = request.route?.path ?? request.path;

    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<{
            statusCode: number;
          }>();
          const duration = (Date.now() - start) / 1000;

          this.metricsService.httpRequestsTotal.inc({
            method,
            route,
            status_code: response.statusCode,
          });

          this.metricsService.httpRequestDurationSeconds.observe(
            { method, route, status_code: response.statusCode },
            duration,
          );
        },
        error: (error: { status?: number }) => {
          const duration = (Date.now() - start) / 1000;
          const statusCode = error.status ?? 500;

          this.metricsService.httpRequestsTotal.inc({
            method,
            route,
            status_code: statusCode,
          });

          this.metricsService.httpRequestDurationSeconds.observe(
            { method, route, status_code: statusCode },
            duration,
          );
        },
      }),
    );
  }
}
