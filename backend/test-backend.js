const axios = require('axios');

// Update this if your backend is running on a different port
const API_URL = 'http://localhost:3000/api/analyze';

const allTestCases = [
  // --- PHASE 1: STANDARD STRUCTURAL TESTS ---
  { 
    name: "PHASE 1: Lexical Error (Invalid Symbol)", 
    code: "int main() { int x = @; }", 
    expected: "lexical" 
  },
  { 
    name: "PHASE 1: Syntactic Error (Missing Semicolon)", 
    code: "int main() { int x = 10 \n return 0; }", 
    expected: "syntactic" 
  },

  // --- PHASE 2: SEMANTIC & SCOPE TESTS ---
  { 
    name: "PHASE 2: Semantic (Redeclaration)", 
    code: "int main() { int x = 10; int x = 20; return 0; }", 
    expected: "semantic" 
  },
  { 
    name: "PHASE 2: Semantic (Undefined Variable)", 
    code: "int main() { y = 10; return 0; }", 
    expected: "semantic" 
  },
  { 
    name: "ADVANCED: Scope Shadowing Conflict", 
    code: "int main() { int x = 5; if(true) { int x = 10; } return 0; }", 
    expected: "semantic" 
  },

  // --- PHASE 3: LOGIC, SAFETY & COMPLEXITY ---
  { 
    name: "PHASE 3: Basic Division by Zero", 
    code: "int main() { int x = 10; int y = 0; int z = x / y; return 0; }", 
    expected: "safetyCheck" 
  },
  { 
    name: "ELITE: Cross-Variable Math Propagation", 
    code: "int main() { int x = 5; int y = x - 5; int z = 100 / y; return 0; }", 
    expected: "safetyCheck" 
  },
  { 
    name: "LOGIC: Infinite Loop (Static Analysis)", 
    code: "int main() { int x = 5; while(x > 0) { x = 5; } return 0; }", 
    expected: "safetyCheck" 
  },

  // --- PHASE 4: TRANSLATION & GAMIFICATION ---
  { 
    name: "TRANSLATOR: Variable Declaration Logic", 
    code: "int main() { int heroHealth = 100; return 0; }", 
    expected: "translation",
    mustContain: "heroHealth"
  },
  { 
    name: "TRANSLATOR: Constant Storage Metaphor", 
    code: "int main() { const float gravity = 9.8; return 0; }", 
    expected: "translation",
    mustContain: "Frozen" // Testing for '❄️ Frozen Value' metaphor
  },
  { 
    name: "GAMIFICATION: XP Reward Calculation", 
    code: "int main() { int x = 10; return 0; }", 
    expected: "gamification",
    minXP: 25 
  },
  { 
    name: "GAMIFICATION: Complexity Penalty", 
    code: "int main() { if(1){if(2){if(3){if(4){return 0;}}}}} return 1; }", 
    expected: "gamification",
    maxXP: 15 // Expect lower XP due to high nesting/complexity
  },

  // --- PHASE 5: COMPLEX PATHS & UNREACHABLE CODE ---
  { 
    name: "PATH: Post-Return Dead Code", 
    code: "int main() { return 0; int x = 10 / 0; }", 
    expected: "success" // Should pass because the error is unreachable
  },
  { 
    name: "PATH: Logical Contradiction", 
    code: "int main() { int x = 5; if (x > 10 && x < 2) { int y = 1 / 0; } return 0; }", 
    expected: "success" // x cannot be >10 and <2 simultaneously, so path is dead
  },

  // --- PHASE 6: GRANDMASTER MEMORY & ARRAYS ---
  { 
    name: "GRANDMASTER: Negative Array Index", 
    code: "int main() { int arr[5]; int x = -1; arr[x] = 10; return 0; }", 
    expected: "safetyCheck" 
  },
  { 
    name: "GRANDMASTER: Array Index via Variable", 
    code: "int main() { int arr[3]; int idx = 5; arr[idx] = 10; return 0; }", 
    expected: "safetyCheck" 
  }
];

async function runTests() {
  console.log("🚀 Initializing Elite CodeSense Validation Suite...");
  console.log(`📡 Target: ${API_URL}\n`);

  let passed = 0;
  const startTime = Date.now();

  for (const test of allTestCases) {
    try {
      const response = await axios.post(API_URL, { sourceCode: test.code, hintsUsed: 0 });
      const data = response.data;

      console.log(`--- [TEST: ${test.name}] ---`);
      
      let testPassed = false;

      // SAFETY CHECKS (Division by Zero, OOB, Infinite Loops)
      if (test.expected === "safetyCheck") {
        const foundSafetyIssue = data.safetyChecks && data.safetyChecks.length > 0;
        testPassed = data.success && foundSafetyIssue;
        console.log(testPassed ? "✅ Logic Risk Detected" : "❌ Logic Risk Missed");
        if (foundSafetyIssue) console.log(`   Message: ${data.safetyChecks[0].message}`);
      } 
      // SUCCESS CHECKS (Validated Paths, Dead Code)
      else if (test.expected === "success") {
        testPassed = data.success && (!data.errors || data.errors.length === 0);
        console.log(testPassed ? "✅ Path Validated" : "❌ Unexpected Block");
      }
      // TRANSLATION CHECKS
      else if (test.expected === "translation") {
        const inExplanations = data.explanations && data.explanations.some(t => t.includes(test.mustContain));
        const inCFG = data.cfg && data.cfg.nodes && data.cfg.nodes.some(node => 
          node.tutorExplanation && node.tutorExplanation.includes(test.mustContain)
        );

        testPassed = inExplanations || inCFG;
        console.log(testPassed ? "✅ Translation Accurate" : "❌ Translation Mismatch");
      }
      // GAMIFICATION CHECKS (XP & Complexity)
      else if (test.expected === "gamification") {
        if (!data.gamification) {
          console.log("❌ Gamification data missing");
        } else {
          const xp = data.gamification.xpEarned;
          if (test.minXP) {
            testPassed = xp >= test.minXP;
            console.log(testPassed ? `✅ XP Awarded Correctly (${xp} XP)` : `❌ Low XP Awarded (${xp})`);
          } else if (test.maxXP) {
            testPassed = xp <= test.maxXP;
            console.log(testPassed ? `✅ Penalty Applied Correctly (${xp} XP)` : `❌ Penalty Failed (Too much XP: ${xp})`);
          }
        }
      }
      // ERROR CHECKS (Lexical, Syntactic, Semantic)
      else {
        const hasCorrectError = data.errors && data.errors.some(e => e.type === test.expected);
        testPassed = !data.success && hasCorrectError;
        console.log(testPassed ? `✅ Correctly Blocked (${test.expected})` : "❌ Error Leaked/Wrong Type");
      }

      console.log("------------------------------------------\n");
      if (testPassed) passed++;

    } catch (err) {
      console.error(`🔴 API Connection Failed: ${err.message}`);
      break; 
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`🏁 Validation Finished in ${duration}s`);
  console.log(`📈 Final Result: ${passed} / ${allTestCases.length} Tests Passed`);
  process.exitCode = passed === allTestCases.length ? 0 : 1;
}

runTests();
