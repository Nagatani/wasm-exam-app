// Monaco Editor のセットアップ
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' } });

let editor;
const defaultCode = `#include <stdio.h>\n\nint main() {\n    int a, b;\n    // 標準入力から値を読み込む\n    if (scanf("%d %d", &a, &b) == 2) {\n        printf("%d\\n", a + b);\n    }\n    return 0;\n}`;

require(['vs/editor/editor.main'], function () {
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: defaultCode,
        language: 'cpp', // C言語向け
        theme: 'vs-dark',
        fontSize: 14,
        automaticLayout: true
    });
});

// UI操作用
const runBtn = document.getElementById('run-btn');
const consoleOutput = document.getElementById('console-output');
const judgeStatus = document.getElementById('judge-status');

runBtn.addEventListener('click', async () => {
    const code = editor.getValue();
    consoleOutput.textContent = "⌛ コンパイル中...\n";
    judgeStatus.classList.add('hidden');

    try {
        await runCodeAndJudge(code);
    } catch (err) {
        consoleOutput.textContent += `\n❌ エラーが発生しました:\n${err.message}`;
    }
});

// 仮想テストケース（講義に合わせて配列で複数定義可能）
const testCases = [
    { input: "5 10\n", expected: "15\n" },
    { input: "100 200\n", expected: "300\n" }
];

async function runCodeAndJudge(sourceCode) {
    // 本来はここで WebAssembly (clang.wasm) を呼び出し、Wasmバイナリを生成します。
    // 例: const wasmBinary = await compileCtoWasm(sourceCode);
    
    consoleOutput.textContent += "⚙️ Wasm 仮想環境を起動中...\n";

    let allPassed = true;
    let logBuffer = "";

    for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        logBuffer += `--- [テストケース ${i + 1}] 実行中 ---\n`;
        logBuffer += `入力: ${tc.input.trim()}\n`;

        // 【Wasm実行シミュレーション部】
        // 実際には、WASMインスタンスの標準入力(STDIN)に `tc.input` を書き込み、
        // 実行後に標準出力(STDOUT)のバッファから結果を回収します。
        const actualOutput = await mockWasmRun(sourceCode, tc.input); 

        logBuffer += `出力: ${actualOutput.trim()}\n`;

        if (actualOutput.trim() === tc.expected.trim()) {
            logBuffer += `👉 結果: 一致 (OK)\n\n`;
        } else {
            logBuffer += `👉 結果: 不一致 (NG) [期待値: ${tc.expected.trim()}]\n\n`;
            allPassed = false;
        }
    }

    consoleOutput.textContent = logBuffer;

    // 判定結果のUI表示
    judgeStatus.classList.remove('hidden');
    if (allPassed) {
        judgeStatus.textContent = "🎉 AC (All Tests Passed!)";
        judgeStatus.className = "mt-2 text-center py-2 rounded font-bold text-lg bg-green-900 text-green-300 border border-green-700";
    } else {
        judgeStatus.textContent = "❌ WA (Wrong Answer)";
        judgeStatus.className = "mt-2 text-center py-2 rounded font-bold text-lg bg-red-900 text-red-300 border border-red-700";
    }
}

// C言語の出力をシミュレートする簡易パーサー（Wasmランタイム接続用のプレースホルダー）
async function mockWasmRun(code, input) {
    return new Promise((resolve) => {
        setTimeout(() => {
            // scanf の挙動を一時的にJSでエミュレート（基盤デバッグ用）
            const numbers = input.trim().split(/\s+/).map(Number);
            if (numbers.length >= 2) {
                resolve((numbers[0] + numbers[1]).toString() + "\n");
            } else {
                resolve("Error: Invalid Input\n");
            }
        }, 800); // 実行速度のリアルな遅延を再現
    });
}