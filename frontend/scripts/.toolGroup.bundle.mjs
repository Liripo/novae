// src/components/chat/tool-renderers/groupToolCalls.ts
function groupToolCalls(content) {
  const callMap = /* @__PURE__ */ new Map();
  const orphanResults = [];
  const ordering = [];
  for (const block of content) {
    if (block.type === "tool_call") {
      const entry = { call: block };
      callMap.set(block.id, entry);
      ordering.push({ type: "tool", id: block.id });
    } else if (block.type === "tool_result") {
      const matching = callMap.get(block.id);
      if (matching) {
        matching.result = block;
      } else {
        orphanResults.push({
          call: {
            type: "tool_call",
            id: block.id,
            name: block.name,
            input: "",
            state: "finished"
          },
          result: block
        });
      }
    } else {
      ordering.push({ type: "other", block });
    }
  }
  const result = [];
  let currentGroup = [];
  const flush = () => {
    if (currentGroup.length > 0) {
      result.push({
        type: "tool_call_group",
        id: `group-${currentGroup[0].call.id}`,
        calls: currentGroup
      });
      currentGroup = [];
    }
  };
  for (const item of ordering) {
    if (item.type === "other") {
      flush();
      result.push(item.block);
    } else {
      const entry = callMap.get(item.id);
      if (entry) currentGroup.push(entry);
    }
  }
  flush();
  for (const orphan of orphanResults) {
    result.push({
      type: "tool_call_group",
      id: `group-orphan-${orphan.call.id}`,
      calls: [orphan]
    });
  }
  return result;
}
function isGroupRunning(calls) {
  return calls.some(({ result }) => !result || result.state === "running");
}
function groupStatus(calls) {
  if (isGroupRunning(calls) || calls.some(({ call }) => call.state === "asking")) {
    return "running";
  }
  if (calls.some(({ result }) => result?.state === "error" || result?.state === "denied")) {
    return "error";
  }
  if (calls.some(({ result }) => result?.state === "interrupted")) {
    return "interrupted";
  }
  return "success";
}
function countFailed(calls) {
  return calls.filter(
    ({ result }) => result?.state === "error" || result?.state === "denied"
  ).length;
}
export {
  countFailed,
  groupStatus,
  groupToolCalls,
  isGroupRunning
};
