import { NextRequest, NextResponse } from 'next/server';
import { runInstall } from '@/lib/installer';
import { Settings, StepUpdateEvent, InstallResult } from '@/lib/types';

// In-memory store for active installations
const activeInstalls = new Map<string, {
  events: Array<{ type: string; data: unknown; timestamp: number }>;
  status: 'running' | 'completed' | 'failed';
  result?: InstallResult;
  error?: string;
}>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serialNumber, settings } = body as { serialNumber: string; settings: Settings };

    if (!serialNumber || !/^[a-zA-Z0-9]{3,}$/.test(serialNumber)) {
      return NextResponse.json(
        { success: false, error: 'Invalid serial number. Must be alphanumeric, minimum 3 characters.' },
        { status: 400 }
      );
    }

    if (!settings?.ghcrUsername || !settings?.ghcrToken) {
      return NextResponse.json(
        { success: false, error: 'GHCR credentials not configured. Please set them in Settings.' },
        { status: 400 }
      );
    }

    const installId = `${serialNumber}-${Date.now()}`;

    activeInstalls.set(installId, {
      events: [],
      status: 'running',
    });

    // Run install in background
    runInstall(
      serialNumber,
      settings,
      (event: string, data: StepUpdateEvent | InstallResult | { error: string }) => {
        const install = activeInstalls.get(installId);
        if (install) {
          install.events.push({ type: event, data, timestamp: Date.now() });
          if (event === 'install_complete') {
            install.status = 'completed';
            install.result = data as InstallResult;
          }
          if (event === 'install_error') {
            install.status = 'failed';
            install.error = (data as { error: string }).error;
          }
        }
      }
    ).catch((err) => {
      const install = activeInstalls.get(installId);
      if (install && install.status === 'running') {
        install.status = 'failed';
        install.error = err instanceof Error ? err.message : 'Unknown error';
      }
    });

    return NextResponse.json({
      success: true,
      installId,
      message: `Installation started for T3S-${serialNumber}`,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// SSE endpoint for streaming progress
export async function GET(request: NextRequest) {
  const installId = request.nextUrl.searchParams.get('installId');

  if (!installId) {
    return NextResponse.json({ success: false, error: 'installId required' }, { status: 400 });
  }

  const install = activeInstalls.get(installId);
  if (!install) {
    return NextResponse.json({ success: false, error: 'Installation not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let lastIndex = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvents = () => {
        while (lastIndex < install.events.length) {
          const event = install.events[lastIndex];
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
          lastIndex++;
        }
      };

      // Poll for events
      const interval = setInterval(() => {
        sendEvents();

        if (install.status !== 'running') {
          sendEvents(); // Send any remaining
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'done', data: { status: install.status, result: install.result, error: install.error } })}\n\n`)
          );
          clearInterval(interval);
          controller.close();

          // Clean up after 60s
          setTimeout(() => activeInstalls.delete(installId), 60000);
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
