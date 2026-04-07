import { NextRequest, NextResponse } from 'next/server';
import { runSdrTest, SdrTestResult } from '@/lib/sdr-tester';
import { Settings, StepUpdateEvent, PrepStepEvent } from '@/lib/types';

function log(msg: string, ...args: unknown[]) {
  console.log(`[api/sdr-test] ${msg}`, ...args);
}

const activeTests = new Map<string, {
  events: Array<{ type: string; data: unknown; timestamp: number }>;
  status: 'running' | 'completed' | 'failed';
  result?: SdrTestResult;
  error?: string;
}>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serialNumber, settings } = body as { serialNumber: string; settings: Settings };

    if (!serialNumber || !/^[a-zA-Z0-9]{3,}$/.test(serialNumber)) {
      return NextResponse.json(
        { success: false, error: 'Invalid serial number.' },
        { status: 400 }
      );
    }

    const testId = `sdr-${serialNumber}-${Date.now()}`;
    log('Starting SDR test %s for serial %s', testId, serialNumber);

    activeTests.set(testId, { events: [], status: 'running' });

    runSdrTest(
      serialNumber,
      settings,
      (event: string, data: StepUpdateEvent | SdrTestResult | PrepStepEvent | { error: string }) => {
        const test = activeTests.get(testId);
        if (test) {
          test.events.push({ type: event, data, timestamp: Date.now() });
          if (event === 'test_complete') {
            test.status = 'completed';
            test.result = data as SdrTestResult;
          }
          if (event === 'test_error') {
            test.status = 'failed';
            test.error = (data as { error: string }).error;
          }
        }
      }
    ).catch((err) => {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      log('SDR test %s failed: %s', testId, errMsg);
      const test = activeTests.get(testId);
      if (test && test.status === 'running') {
        test.status = 'failed';
        test.error = errMsg;
        test.events.push({ type: 'test_error', data: { error: errMsg }, timestamp: Date.now() });
      }
    });

    return NextResponse.json({ success: true, testId });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const testId = request.nextUrl.searchParams.get('testId');

  if (!testId) {
    return NextResponse.json({ success: false, error: 'testId required' }, { status: 400 });
  }

  const test = activeTests.get(testId);
  if (!test) {
    return NextResponse.json({ success: false, error: 'Test not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let lastIndex = 0;

  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        while (lastIndex < test.events.length) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(test.events[lastIndex])}\n\n`));
          lastIndex++;
        }

        if (test.status !== 'running') {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'done', data: { status: test.status, result: test.result, error: test.error } })}\n\n`)
          );
          clearInterval(interval);
          controller.close();
          setTimeout(() => activeTests.delete(testId), 60000);
        }
      }, 100);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
