import { createContext } from 'react';

export type Side = 'left' | 'right';

export type Divider =
  {
    side: Side;

    width: number;

    min: number;

    max: number;

    Change: (value?: number) => void
  };

export const Panes = createContext<Record<Side, Divider> | null>(null);

