import type { NodeTypes } from '@xyflow/react';
import BaseNode from './BaseNode';
import { NODE_TYPE_DEFINITIONS } from '../types/nodeTypes';

export const nodeTypes: NodeTypes = Object.keys(NODE_TYPE_DEFINITIONS).reduce(
  (acc, key) => {
    acc[key] = BaseNode;
    return acc;
  },
  {} as NodeTypes
);
