// tools/generateIndex.js
//
// 실행 후 → LTspice 전체 ASY 트리를 자동으로 index.json으로 만들어준다.

const fs = require("fs");
const path = require("path");

// LTspice 심볼 폴더 (네 프로젝트 기준)
const ROOT = path.join(__dirname, "../public/symbols/sym");

function scanDir(dirPath, basePath = "sym") {
  const items = fs.readdirSync(dirPath);

  const files = [];
  const folders = [];

  for (const item of items) {
    const full = path.join(dirPath, item);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      folders.push(scanDir(full, path.join(basePath, item)));
    } else if (item.toLowerCase().endsWith(".asy")) {
      files.push(item);
    }
  }

  return {
    path: basePath,
    files,
    folders,
  };
}

// 디렉토리 스캔 실행
const tree = scanDir(ROOT);

// index.json 저장
const outPath = path.join(__dirname, "../public/symbols/index.json");
fs.writeFileSync(outPath, JSON.stringify(tree, null, 2), "utf8");

console.log("✔ index.json 생성 완료!");
console.log("저장 위치:", outPath);
