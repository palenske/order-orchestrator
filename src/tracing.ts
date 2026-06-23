import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url:
      (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://tempo:4318') +
      '/v1/traces',
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

process.on('SIGTERM', () => {
  sdk.shutdown().then(
    () => null,
    () => null,
  );
});
