export interface EngineTurnResult
{
  status: 'completed' | 'cancelled' | 'failed';

  error?: string;

  output?: string;
}

export interface EngineTurn
{
  readonly turnId: string;

  readonly done: Promise<EngineTurnResult>;
}

/** 输入按提交顺序执行；追加、停止与事件始终按轮次关联。 */
export interface EngineInstance<Image, Event>
{
  readonly kind: string;

  readonly supportsAppend: boolean;

  Submit(input: string, context?: string): EngineTurn;

  Append(turnId: string, input: string, images: Image[], signal: AbortSignal): Promise<void>;

  Stop(turnId: string): Promise<void>;

  Subscribe(listener: (turnId: string, event: Event) => void): () => void;
}
