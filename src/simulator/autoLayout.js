// autoLayout.js
const GRID = 20;

/** GRID 기준 스냅 */
function snap(v) {
  return Math.round(v / GRID) * GRID;
}

/** 그래프 형태로 인접 리스트 생성 */
function buildGraph(elements, wires) {
  const g = {};
  elements.forEach(el => { g[el.id] = []; });

  wires.forEach(w => {
    g[w.a.el].push(w.b.el);
    g[w.b.el].push(w.a.el);
  });

  return g;
}

/** BFS 기반 레벨 자동 계산 */
function computeLevels(elements, wires) {
  const graph = buildGraph(elements, wires);

  // 전원을 루트로 사용
  const roots = elements
    .filter(el => el.type === "vsource" || el.type === "ground")
    .map(el => el.id);

  if (roots.length === 0) {
    // 전원이 없으면 임의로 첫 번째 요소를 루트로
    roots.push(elements[0].id);
  }

  const level = {};
  const visited = new Set();
  const queue = [];

  roots.forEach(r => {
    level[r] = 0;
    visited.add(r);
    queue.push(r);
  });

  while (queue.length > 0) {
    const cur = queue.shift();
    graph[cur].forEach(next => {
      if (!visited.has(next)) {
        visited.add(next);
        level[next] = level[cur] + 1;
        queue.push(next);
      }
    });
  }

  // 아직 레벨이 없는 분리된 노드들
  elements.forEach(el => {
    if (!(el.id in level)) level[el.id] = 0;
  });

  return level;
}

/** 레벨 기반 x,y 좌표 자동 배치 */
export function autoLayout(elements, wires) {
  if (!elements || elements.length === 0) return elements;

  const level = computeLevels(elements, wires);

  // 레벨별 그룹
  const groups = {};
  elements.forEach(el => {
    const lv = level[el.id];
    if (!groups[lv]) groups[lv] = [];
    groups[lv].push(el);
  });

  // x,y 할당
  const newElements = elements.map(el => {
    const lv = level[el.id];
    const index = groups[lv].indexOf(el);

    const x = snap(200 + lv * 200);
    const y = snap(200 + index * 120);

    return {
      ...el,
      x,
      y,
      rot: 0,  // auto-layout은 기본적으로 rot=0 배치
    };
  });

  return newElements;
}
