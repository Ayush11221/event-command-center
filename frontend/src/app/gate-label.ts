// Gates currently have no stored display name. Use the same deterministic ID
// ordering as the authorized scope response without displaying those IDs.
export function gateLabel(
  gates: { gate_id: string }[],
  gateId: string | null,
): string {
  const index = [...gates]
    .sort((a, b) => a.gate_id.localeCompare(b.gate_id))
    .findIndex((gate) => gate.gate_id === gateId);
  return index < 0 ? "Gate unavailable" : `Gate ${index + 1}`;
}
