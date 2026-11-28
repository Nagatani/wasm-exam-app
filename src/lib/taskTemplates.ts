import type { ComparisonMode, Language } from '../types/exam';

export interface TaskTemplateSampleCase {
  input: string;
  expectedOutput: string;
  isSample: boolean;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  statementMarkdown: string;
  comparisonMode: ComparisonMode;
  floatTolerance?: number;
  starterCodeByLanguage: Record<Language, string>;
  sampleCases: TaskTemplateSampleCase[];
}

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: 'single-input-calc',
    name: '単一入力と計算',
    description: '1行の整数入力を受け取り、計算結果を出力する基本問題',
    comparisonMode: 'EXACT',
    statementMarkdown: `## 【問題】
整数 $A, B$ が与えられます。$A + B$ の値を出力してください。

## 【入力形式】
標準入力から以下の形式で与えられます。

\`\`\`
A B
\`\`\`

## 【出力形式】
計算結果を整数で1行に出力してください。

## 【制約】
- $-10^4 \\le A, B \\le 10^4$
- 入力はすべて整数
`,
    starterCodeByLanguage: {
      C: `#include <stdio.h>

int main(void) {
    int a, b;
    if (scanf("%d %d", &a, &b) != 2) return 0;

    // ここに計算処理を書く
    printf("%d\\n", a + b);
    return 0;
}
`,
      JAVA: `// JEP 495: クラス宣言なしの簡易ソースファイル + インスタンス main
void main() {
    String[] parts = IO.readln().trim().split("\\\\s+");
    int a = Integer.parseInt(parts[0]);
    int b = Integer.parseInt(parts[1]);

    // ここに計算処理を書く
    IO.println(a + b);
}
`,
      JS: `const [a, b] = readline().trim().split(/\\s+/).map(Number);

// ここに計算処理を書く
print(a + b);
`,
      TS: `const [a, b]: number[] = readline().trim().split(/\\s+/).map(Number);

// ここに計算処理を書く
print(a + b);
`,
      PYTHON: `a, b = map(int, input().split())

# ここに計算処理を書く
print(a + b)
`,
    },
    sampleCases: [
      { input: '3 5', expectedOutput: '8', isSample: true },
      { input: '0 0', expectedOutput: '0', isSample: false },
      { input: '-10 4', expectedOutput: '-6', isSample: false },
      { input: '10000 -10000', expectedOutput: '0', isSample: false },
    ],
  },
  {
    id: 'int-array',
    name: 'N 個の整数配列の処理',
    description: '要素数 N と N 個の整数列を読み込み、集計・探索を行う問題',
    comparisonMode: 'EXACT',
    statementMarkdown: `## 【問題】
$N$ 個の整数 $A_1, A_2, \\dots, A_N$ が与えられます。これらの合計値を出力してください。

## 【入力形式】
標準入力から以下の形式で与えられます。

\`\`\`
N
A_1 A_2 ... A_N
\`\`\`

## 【出力形式】
合計値を整数で1行に出力してください。

## 【制約】
- $1 \\le N \\le 1000$
- $-10^4 \\le A_i \\le 10^4$
- 入力はすべて整数
`,
    starterCodeByLanguage: {
      C: `#include <stdio.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 0;

    int a[1000];
    for (int i = 0; i < n; i++) {
        scanf("%d", &a[i]);
    }

    // ここに配列の処理を書く
    int sum = 0;
    for (int i = 0; i < n; i++) {
        sum += a[i];
    }
    printf("%d\\n", sum);
    return 0;
}
`,
      JAVA: `// JEP 495: クラス宣言なしの簡易ソースファイル + インスタンス main
void main() {
    int n = Integer.parseInt(IO.readln().trim());
    String[] parts = IO.readln().trim().split("\\\\s+");
    int[] a = new int[n];
    for (int i = 0; i < n; i++) {
        a[i] = Integer.parseInt(parts[i]);
    }

    // ここに配列の処理を書く
    int sum = 0;
    for (int v : a) {
        sum += v;
    }
    IO.println(sum);
}
`,
      JS: `const n = Number(readline().trim());
const a = readline().trim().split(/\\s+/).slice(0, n).map(Number);

// ここに配列の処理を書く
let sum = 0;
for (const v of a) sum += v;
print(sum);
`,
      TS: `const n: number = Number(readline().trim());
const a: number[] = readline().trim().split(/\\s+/).slice(0, n).map(Number);

// ここに配列の処理を書く
let sum = 0;
for (const v of a) sum += v;
print(sum);
`,
      PYTHON: `n = int(input())
a = list(map(int, input().split()))[:n]

# ここに配列の処理を書く
print(sum(a))
`,
    },
    sampleCases: [
      { input: '4\n1 2 3 4', expectedOutput: '10', isSample: true },
      { input: '1\n42', expectedOutput: '42', isSample: false },
      { input: '3\n0 0 0', expectedOutput: '0', isSample: false },
      { input: '5\n-5 10 -3 2 -4', expectedOutput: '0', isSample: false },
    ],
  },
  {
    id: 'conditional-branch',
    name: '条件分岐（判定・分類）',
    description: '入力値に応じて条件を判定し、分類ラベルを出力する問題',
    comparisonMode: 'EXACT',
    statementMarkdown: `## 【問題】
整数 $X$ が与えられます。$X$ が正の数なら \`POSITIVE\`、$0$ なら \`ZERO\`、負の数なら \`NEGATIVE\` と出力してください。

## 【入力形式】
標準入力から以下の形式で与えられます。

\`\`\`
X
\`\`\`

## 【出力形式】
判定結果（\`POSITIVE\` / \`ZERO\` / \`NEGATIVE\` のいずれか）を1行に出力してください。

## 【制約】
- $-10^6 \\le X \\le 10^6$
- $X$ は整数
`,
    starterCodeByLanguage: {
      C: `#include <stdio.h>

int main(void) {
    int x;
    if (scanf("%d", &x) != 1) return 0;

    // ここに条件分岐を書く
    if (x > 0) {
        printf("POSITIVE\\n");
    } else if (x == 0) {
        printf("ZERO\\n");
    } else {
        printf("NEGATIVE\\n");
    }
    return 0;
}
`,
      JAVA: `// JEP 495: クラス宣言なしの簡易ソースファイル + インスタンス main
void main() {
    int x = Integer.parseInt(IO.readln().trim());

    // ここに条件分岐を書く
    if (x > 0) {
        IO.println("POSITIVE");
    } else if (x == 0) {
        IO.println("ZERO");
    } else {
        IO.println("NEGATIVE");
    }
}
`,
      JS: `const x = Number(readline().trim());

// ここに条件分岐を書く
if (x > 0) {
  print('POSITIVE');
} else if (x === 0) {
  print('ZERO');
} else {
  print('NEGATIVE');
}
`,
      TS: `const x: number = Number(readline().trim());

// ここに条件分岐を書く
if (x > 0) {
  print('POSITIVE');
} else if (x === 0) {
  print('ZERO');
} else {
  print('NEGATIVE');
}
`,
      PYTHON: `x = int(input())

# ここに条件分岐を書く
if x > 0:
    print("POSITIVE")
elif x == 0:
    print("ZERO")
else:
    print("NEGATIVE")
`,
    },
    sampleCases: [
      { input: '10', expectedOutput: 'POSITIVE', isSample: true },
      { input: '0', expectedOutput: 'ZERO', isSample: true },
      { input: '-1', expectedOutput: 'NEGATIVE', isSample: false },
      { input: '1', expectedOutput: 'POSITIVE', isSample: false },
      { input: '-1000000', expectedOutput: 'NEGATIVE', isSample: false },
    ],
  },
  {
    id: 'string-processing',
    name: '文字列処理',
    description: '1行の文字列を受け取り、文字数のカウントや変換・判定を行う問題',
    comparisonMode: 'EXACT',
    statementMarkdown: `## 【問題】
英字からなる文字列 $S$ が与えられます。$S$ の文字数を出力してください。

## 【入力形式】
標準入力から以下の形式で与えられます。

\`\`\`
S
\`\`\`

## 【出力形式】
処理結果を1行に出力してください。

## 【制約】
- $1 \\le |S| \\le 100$
- $S$ は半角英字（\`A\`〜\`Z\`, \`a\`〜\`z\`）のみからなる
`,
    starterCodeByLanguage: {
      C: `#include <stdio.h>
#include <string.h>

int main(void) {
    char s[256];
    if (scanf("%255s", s) != 1) return 0;

    // ここに文字列処理を書く
    printf("%zu\\n", strlen(s));
    return 0;
}
`,
      JAVA: `// JEP 495: クラス宣言なしの簡易ソースファイル + インスタンス main
void main() {
    String s = IO.readln().trim();

    // ここに文字列処理を書く
    IO.println(s.length());
}
`,
      JS: `const s = readline().trim();

// ここに文字列処理を書く
print(s.length);
`,
      TS: `const s: string = readline().trim();

// ここに文字列処理を書く
print(s.length);
`,
      PYTHON: `s = input().strip()

# ここに文字列処理を書く
print(len(s))
`,
    },
    sampleCases: [
      { input: 'Hello', expectedOutput: '5', isSample: true },
      { input: 'a', expectedOutput: '1', isSample: false },
      { input: 'AbCdEfGhIj', expectedOutput: '10', isSample: false },
    ],
  },
  {
    id: 'float-calc',
    name: '浮動小数点計算（誤差許容 FLOAT 推奨）',
    description: '実数の計算結果を誤差許容（FLOAT）で判定する問題',
    comparisonMode: 'FLOAT',
    floatTolerance: 0.001,
    statementMarkdown: `## 【問題】
2つの実数 $A, B$ が与えられます。$A$ と $B$ の平均値 $\\frac{A + B}{2}$ を出力してください。

## 【入力形式】
標準入力から以下の形式で与えられます。

\`\`\`
A B
\`\`\`

## 【出力形式】
平均値を実数で1行に出力してください。絶対誤差または相対誤差が $10^{-3}$ 以下であれば正解とみなされます。

## 【制約】
- $-10^4 \\le A, B \\le 10^4$
- 入力は実数（小数点以下を含む場合がある）
`,
    starterCodeByLanguage: {
      C: `#include <stdio.h>

int main(void) {
    double a, b;
    if (scanf("%lf %lf", &a, &b) != 2) return 0;

    // ここに実数計算を書く
    printf("%.6f\\n", (a + b) / 2.0);
    return 0;
}
`,
      JAVA: `// JEP 495: クラス宣言なしの簡易ソースファイル + インスタンス main
void main() {
    String[] parts = IO.readln().trim().split("\\\\s+");
    double a = Double.parseDouble(parts[0]);
    double b = Double.parseDouble(parts[1]);

    // ここに実数計算を書く
    IO.println((a + b) / 2.0);
}
`,
      JS: `const [a, b] = readline().trim().split(/\\s+/).map(Number);

// ここに実数計算を書く
print((a + b) / 2);
`,
      TS: `const [a, b]: number[] = readline().trim().split(/\\s+/).map(Number);

// ここに実数計算を書く
print((a + b) / 2);
`,
      PYTHON: `a, b = map(float, input().split())

# ここに実数計算を書く
print((a + b) / 2)
`,
    },
    sampleCases: [
      { input: '1.5 2.5', expectedOutput: '2.0', isSample: true },
      { input: '0 0', expectedOutput: '0.0', isSample: false },
      { input: '1 2', expectedOutput: '1.5', isSample: false },
      { input: '-3.25 1.75', expectedOutput: '-0.75', isSample: false },
    ],
  },
];

export function getTaskTemplateById(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.id === id);
}
