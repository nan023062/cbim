/** 能力层运行实例管理。岗位可以先准备，只有引擎启动成功才发布运行中的 Agent。 */
import { changeEvents } from '../events';
import { Team, type TeamMember, type TeamDescription } from './team';
import { AgentTokenUsage, type AgentChange, type AgentRole } from './agent';

/** 一个运行身份持有一个已启动的引擎。 */
export interface Agent<Engine>
{
  readonly Subscribe: AgentTokenUsage['Subscribe'];
  readonly id: string;

  readonly usage: Pick<AgentTokenUsage, 'Read' | 'state' | 'totalTokens' | 'tokensPerSecond'>;

  readonly role: AgentRole;

  readonly engine: Engine;
}

/** 调用方为本次启动选择引擎工厂，并提供它所需的参数。 */
export interface AgentEngineFactory<Parameters, Engine>
{
  readonly parameters: Parameters;

  CreateEngine(parameters: Parameters, id: string, role: AgentRole, report: ReturnType<AgentTokenUsage["Begin"]>): Promise<{ session: Engine; Close(): Promise<void> }>;
}

/** Owns agent instances, engine lifecycles and events for one Office. */
export class AgentInstances
{
  private readonly changes = changeEvents<{ type: AgentChange | 'allocated' | 'engine-ready' | 'cleared'; agentId: string }>();
  public readonly Subscribe = this.changes.Subscribe;

  private readonly _active = new Map<string, Agent<unknown>>();

  public ListActiveAgents() { return [...this._active.values()]; }

  private readonly _instances = new Map<string,
    {
      ready: Promise<
        {
          Close(): Promise<void>
        }>;

      usage: AgentTokenUsage;
      unsubscribe(): void;
      closing?: Promise<void>
    }>();

  /** 为岗位分配唯一实例。每次激活使用当前任务的引擎上下文。 */
  private readonly _allocated = new Map<string, Agent<unknown>>();
  private _primary?: ReturnType<AgentInstances["Allocate"]>;
  public MainAgent() { return this._primary ??= this.Allocate(); }
  public ListAgents() { return [...new Map([...this._active, ...this._allocated]).values()]; }
  public ClearAgents() { const ids = [...this._allocated.keys()]; this._allocated.clear(); this._primary = undefined; for (const agentId of ids) this.changes.Emit({ type: 'cleared', agentId }); }

  public async CloseInstances(): Promise<void>
  {
    await Promise.all([...this._instances.keys()].map(id => this.Destroy(id)));
    this.ClearAgents();
  }

  public Allocate()
  {
    const id = crypto.randomUUID();
    let running: Agent<unknown> | undefined;
    const usage = new AgentTokenUsage();
    const current = () => {
      if (!running)
        throw new Error('Agent 当前没有运行中的任务');
      return running;
    };
    const instance = Object.freeze({
      id,
      usage, Subscribe: usage.Subscribe,
      get role() { return current().role; },
      get engine() { return current().engine; },
      Open: async <Parameters, Engine>(role: AgentRole, factory: AgentEngineFactory<Parameters, Engine>) => {
        const active = await this.CreateAndStart(id, role, factory, usage);
        running = active;
        return { agent: instance, engine: active.engine };
      },
      Close: async () => {
        const previous = running;
        await this.Destroy(id);
        if (running === previous)
          running = undefined;
      }
    });
    this._allocated.set(id, instance);
    this.changes.Emit({ type: 'allocated', agentId: id });
    return instance;
  }

  public async CreateAndStart<Parameters, Engine>(id: string, role: AgentRole, factory: AgentEngineFactory<Parameters, Engine>, usage = new AgentTokenUsage()): Promise<Agent<Engine>>
  {
    if (this._instances.has(id))
      throw new Error('Agent 实例已登记');

    const unsubscribe = usage.Subscribe(type => this.changes.Emit({ type, agentId: id }));
    const report = usage.Begin();
    const ready = Promise.resolve().then(() => factory.CreateEngine(factory.parameters, id, role, report)).then(resource => ({ agent: Object.freeze({ id, role, usage, Subscribe: usage.Subscribe, engine: resource.session }), Close: () => resource.Close() }));

    this._instances.set(id, { ready, usage, unsubscribe });

    try
    {
      const agent = (await ready).agent;
      this._active.set(id, agent);
      this.changes.Emit({ type: 'engine-ready', agentId: id });
      return agent;
    }
    catch (error)
    {
      usage.End(); unsubscribe();
      this._instances.delete(id);

      throw error;
    }
  }

  /** 同时关闭共享释放回执；准备尚在进行时先等待其结果。 */
  public Destroy(id: string): Promise<void>
  {
    const entry = this._instances.get(id);

    if (!entry)
      return Promise.resolve();

    return entry.closing ??= entry.ready.then(owned => owned.Close(), () => { }).then(() => { if (this._instances.get(id) === entry) { this._instances.delete(id); this._active.delete(id); entry.usage.End(); entry.unsubscribe(); } }).catch(error => { entry.closing = undefined; throw error; });
  }
}

/** 服务绑定在运行宿主上，关闭未成功时保留登记以便重试。 */
export class Organization extends AgentInstances
{
  public readonly kind = 'organization' as const;

  private _children: readonly (Team | TeamMember)[] = Object.freeze([]);

  public constructor(public readonly id: string = crypto.randomUUID()) { super(); }

  public get children() { return this._children; }

  public ReplaceChildren(children: TeamDescription['children']): void
  {
    const seen = new Set<string>([this.id]);
    const assignedAgents = new Set<string>();

    function build(node: TeamDescription | TeamMember): Team | TeamMember
    {
      if (!node.id || seen.has(node.id))
        throw new Error('组织节点身份为空或重复');

      seen.add(node.id);

      if (node.kind === 'team')
        return new Team(node.id, node.children.map(build));

      if (assignedAgents.has(node.agentId))
        throw new Error('同一办公室的 Agent 只能绑定一个 Worker');

      assignedAgents.add(node.agentId);
      return Object.freeze({ ...node, model: Object.freeze({ ...node.model }) });
    }

    this._children = Object.freeze(children.map(build));
  }

  public FindMember(id: string): TeamMember | undefined
  {
    for (const child of this.children) {
      const found = child.kind === 'team' ? child.FindMember(id) : child.id === id ? child : undefined;
      if (found) return found;
    }
  }

  public FindTeam(id: string): Team | undefined
  {
    function find(nodes: readonly (Team | TeamMember)[]): Team | undefined {
      for (const node of nodes) {
        if (node.kind !== 'team') continue;
        const found = node.id === id ? node : find(node.children);
        if (found) return found;
      }
    }
    return find(this.children);
  }

}
