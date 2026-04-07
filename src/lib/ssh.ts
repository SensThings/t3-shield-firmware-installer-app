import { Client, type ConnectConfig } from 'ssh2';

export interface SSHConnection {
  client: Client;
  exec: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>;
  execStream: (
    command: string,
    onStdout: (data: string) => void,
    onStderr: (data: string) => void
  ) => Promise<number>;
  uploadFile: (content: string, remotePath: string) => Promise<void>;
  close: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SSH_ALGORITHMS: any = {
  kex: [
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group14-sha1',
  ],
};

function buildConnection(client: Client): SSHConnection {
  const exec = (command: string): Promise<{ stdout: string; stderr: string; code: number }> => {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('data', (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        stream.on('close', (code: number) => resolve({ stdout, stderr, code: code || 0 }));
        stream.on('error', reject);
      });
    });
  };

  const execStream = (
    command: string,
    onStdout: (data: string) => void,
    onStderr: (data: string) => void
  ): Promise<number> => {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) return reject(err);
        stream.on('data', (data: Buffer) => onStdout(data.toString()));
        stream.stderr.on('data', (data: Buffer) => onStderr(data.toString()));
        stream.on('close', (code: number) => resolve(code || 0));
        stream.on('error', reject);
      });
    });
  };

  const uploadFile = (content: string, remotePath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(new Error(`SFTP init failed: ${err.message}`));
        const writeStream = sftp.createWriteStream(remotePath);
        writeStream.on('close', () => {
          sftp.end();
          resolve();
        });
        writeStream.on('error', (e: Error) => {
          sftp.end();
          reject(new Error(`SFTP write failed: ${e.message}`));
        });
        writeStream.write(content);
        writeStream.end();
      });
    });
  };

  return {
    client,
    exec,
    execStream,
    uploadFile,
    close: () => client.end(),
  };
}

export async function connectSSH(config: {
  host: string;
  username: string;
  password: string;
  timeout?: number;
}): Promise<SSHConnection> {
  const client = new Client();

  const connectConfig: ConnectConfig = {
    host: config.host,
    port: 22,
    username: config.username,
    password: config.password,
    readyTimeout: config.timeout || 10000,
    algorithms: SSH_ALGORITHMS,
  };

  await new Promise<void>((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect(connectConfig);
  });

  return buildConnection(client);
}

/**
 * Connect to a target device via an intermediate jump host (ProxyJump).
 * Server → SSH into jumpHost → TCP forward to target → SSH into target.
 *
 * Returns connections to both the jump host and the target.
 * Call closeAll() to close both connections.
 */
export async function connectViaProxy(config: {
  jumpHost: string;
  jumpUsername: string;
  jumpPassword: string;
  targetHost: string;
  targetUsername: string;
  targetPassword: string;
  timeout?: number;
}): Promise<{
  jump: SSHConnection;
  target: SSHConnection;
  closeAll: () => void;
}> {
  // Connect to jump host
  const jumpClient = new Client();
  await new Promise<void>((resolve, reject) => {
    jumpClient.on('ready', resolve);
    jumpClient.on('error', reject);
    jumpClient.connect({
      host: config.jumpHost,
      port: 22,
      username: config.jumpUsername,
      password: config.jumpPassword,
      readyTimeout: config.timeout || 10000,
      algorithms: SSH_ALGORITHMS,
    });
  });

  // Create TCP tunnel through jump host to target
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await new Promise<any>((resolve, reject) => {
    jumpClient.forwardOut('127.0.0.1', 0, config.targetHost, 22, (err, stream) => {
      if (err) return reject(new Error(`Tunnel to ${config.targetHost} failed: ${err.message}`));
      resolve(stream);
    });
  });

  // Connect to target through the tunnel
  const targetClient = new Client();
  await new Promise<void>((resolve, reject) => {
    targetClient.on('ready', resolve);
    targetClient.on('error', reject);
    targetClient.connect({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sock: stream as any,
      username: config.targetUsername,
      password: config.targetPassword,
      readyTimeout: config.timeout || 10000,
      algorithms: SSH_ALGORITHMS,
    });
  });

  const jump = buildConnection(jumpClient);
  const target = buildConnection(targetClient);

  return {
    jump,
    target,
    closeAll: () => {
      targetClient.end();
      jumpClient.end();
    },
  };
}

export async function testConnection(config: {
  host: string;
  username: string;
  password: string;
}): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const conn = await connectSSH({ ...config, timeout: 5000 });
    const latencyMs = Date.now() - start;
    conn.close();
    return { success: true, message: `Connected (${latencyMs}ms)`, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('Authentication')) {
      return { success: false, message: 'Authentication failed — check credentials in Settings', latencyMs };
    }
    if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('Timed out')) {
      return { success: false, message: `Cannot reach device at ${config.host} — check Ethernet cable`, latencyMs };
    }
    return { success: false, message, latencyMs };
  }
}
