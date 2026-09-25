import type { Edge, Node } from '@xyflow/react'
import type { ControlFlowNode } from '@/types'

export interface ExtendedNodeData extends ControlFlowNode {
  violation?: boolean
  visited?: boolean
  onHover?: (message: string | null) => void
  onEdit?: (id: string) => void
}

export type FlowNodeType =
  | 'terminator'
  | 'process'
  | 'decision'
  | 'io'
  | 'predefined'
  | 'connector'
  | 'off_page_connector'
  | 'document'
  | 'manual_input'
  | 'delay'
  | 'database'
  | 'junction'

export interface EditState {
  nodeId: string
  label: string
  code: string
  type: string
}

export interface EdgeEditState {
  edgeId: string
  label: string
  x: number
  y: number
}

export type FlowGraphChangeHandler = (
  nodes: Node<ExtendedNodeData>[],
  edges: Edge[],
) => void
