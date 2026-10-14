import { context, metrics, trace, type Context, type Span, type Tracer } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AggregationTemporality,
  ConsoleMetricExporter,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

export type OtelExporterKind = 'console' | 'memory' | 'none';

export interface Telemetry {
  kind: OtelExporterKind;
  spans: InMemorySpanExporter | null;
  metricExporter: InMemoryMetricExporter | null;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Registers global trace and metric providers. With `none`, nothing is registered and the OpenTelemetry
 * API stays a no-op, so instrumented code costs nothing in tests and the demo.
 */
export function initTelemetry(kind: OtelExporterKind, serviceName: string): Telemetry {
  if (kind === 'none') {
    return {
      kind,
      spans: null,
      metricExporter: null,
      flush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
  }
  const resource = resourceFromAttributes({ 'service.name': serviceName });
  const spanExporter = kind === 'memory' ? new InMemorySpanExporter() : new ConsoleSpanExporter();
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  const metricExporter =
    kind === 'memory'
      ? new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
      : new ConsoleMetricExporter();
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new MeterProvider({ resource, readers: [reader] });
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    kind,
    spans: spanExporter instanceof InMemorySpanExporter ? spanExporter : null,
    metricExporter: metricExporter instanceof InMemoryMetricExporter ? metricExporter : null,
    async flush() {
      await tracerProvider.forceFlush();
      await meterProvider.forceFlush();
    },
    async shutdown() {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      trace.disable();
      metrics.disable();
    },
  };
}

export function tracer(): Tracer {
  return trace.getTracer('support-reliability-lab');
}

/** Starts a span as a child of `parent` without relying on an async context manager. */
export function startChildSpan(
  name: string,
  parent: Span | null,
  attributes: Record<string, string | number | boolean> = {},
): Span {
  const parentContext: Context =
    parent === null ? context.active() : trace.setSpan(context.active(), parent);
  return tracer().startSpan(name, { attributes }, parentContext);
}

/** Trace ID of a recording span, or null when telemetry is off. */
export function recordingTraceId(span: Span): string | null {
  const spanContext = span.spanContext();
  return trace.isSpanContextValid(spanContext) ? spanContext.traceId : null;
}
