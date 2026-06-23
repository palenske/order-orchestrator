import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (otelEndpoint) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: `${otelEndpoint}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
    serviceName: 'order-orchestrator',
  });

  sdk.start();

  const shutdown = () => {
    sdk.shutdown().then(
      () => null,
      () => null,
    );
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
