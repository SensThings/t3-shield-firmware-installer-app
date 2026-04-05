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
    algorithms: {
      kex: [
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group14-sha1',
      ],
    },
  };

  await new Promise<void>((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect(connectConfig);
  });

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
      // Use base64 encoding to avoid shell quoting issues
      const b64 = Buffer.from(content).toString('base64');
      const cmd = `echo '${b64}' | base64 -d > ${remotePath}`;
      client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let stderr = '';
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        stream.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error(`Upload failed (code ${code}): ${stderr}`));
        });
        stream.on('error', reject);
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
