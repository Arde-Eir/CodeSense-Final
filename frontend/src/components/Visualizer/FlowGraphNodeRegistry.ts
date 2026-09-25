import {
  ConnectorNode,
  DatabaseNode,
  DecisionNode,
  DelayNode,
  DocumentNode,
  IONode,
  JunctionNode,
  ManualInputNode,
  OffPageConnectorNode,
  PredefinedNode,
  ProcessNode,
  TerminatorNode,
} from './FlowGraphNodes'

export const nodeTypes = {
  terminator: TerminatorNode,
  process: ProcessNode,
  decision: DecisionNode,
  io: IONode,
  predefined: PredefinedNode,
  connector: ConnectorNode,
  off_page_connector: OffPageConnectorNode,
  document: DocumentNode,
  manual_input: ManualInputNode,
  delay: DelayNode,
  database: DatabaseNode,
  junction: JunctionNode,
}
