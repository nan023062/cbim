/**
 * 作用定位：汇总本宿主正在使用的连接器实例及其会话。
 * 设计原因：宿主级登记只供资源观测，工具授权与会话释放仍由真实连接器及调用方负责。
 */
import type { ConnectorTaskContext } from './connector';

type Device =
  {
    id: string;

    productId: string;

    mode: 'exclusive' | 'concurrent';

    sessions: Set<ConnectorTaskContext>
  };

const devices = new Map<string, Device>();

const listeners = new Set<() => void>();

export function listActiveConnectors()
{
  return Array.from(devices.values(), device => ({ ...device, sessions: [...device.sessions] }));
}

export function subscribeConnectorActivity(listener: () => void)
{
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function registerConnector(mode: Device['mode'], productId: string)
{
  const device: Device = { id: crypto.randomUUID(), productId, mode, sessions: new Set() };

  const notify = () => { for (const listener of listeners) { try { listener(); } catch (error) { console.error('Connector observer failed', error); } } };

  devices.set(device.id, device);

  notify();

  return {
    Open(context: ConnectorTaskContext)
    {
      const owner = Object.freeze({ ...context });

      device.sessions.add(owner);

      notify();

      return () => { if (device.sessions.delete(owner)) notify(); };
    },

    Close()
    {
      devices.delete(device.id);

      notify();
    },
  };
}
