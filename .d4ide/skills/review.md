# Code Review Skill

Review the current git diff and recently modified files.

Focus areas:
1. Potential logic bugs and regressions.
2. Unhandled error cases or promise rejections.
3. TypeScript typing safety and boundary validation.
4. Security vulnerabilities (input validation, SQL/command injection, secret exposure).
5. Performance bottlenecks or unnecessary re-renders.

Output format:
Provide bulleted findings with file paths, severity (Low, Medium, High), and suggested fixes.
Do not modify code directly unless requested.
