import { readFileSync } from "node:fs";
import type { AstResult } from "./types.js";

/**
 * Extract labels, procedures, imports, and types from assembly files using regex.
 * Supports NASM, MASM, and GNU Assembler (GAS) syntax.
 * File extensions: .asm, .s, .S, .inc
 */
export function extractAsm(filePath: string): AstResult {
  const functions: string[] = [];
  const types: string[] = [];
  const imports: string[] = [];
  const exports: string[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { exports: [], imports: [], functions: [], types: [] };
  }

  // Strip single-line comments (; for NASM/MASM, // for some assemblers, @ for ARM)
  content = content.replace(/;.*$/gm, "");
  content = content.replace(/\/\/.*$/gm, "");
  content = content.replace(/@.*$/gm, "");
  // Strip C-style multi-line comments
  content = content.replace(/\/\*[\s\S]*?\*\//g, "");

  // Strip string literals to avoid false matches
  content = content.replace(/"([^"\\]|\\.)*"/g, '""');

  const lines = content.split("\n");

  // Track section state to skip directive-only sections
  let inDataSection = false;
  let inCodeSection = true;

  const registerNames = new Set([
    // x86-32
    "eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp", "eip",
    // x86-64
    "rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp", "rip",
    "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15",
    "r8d", "r9d", "r10d", "r11d", "r12d", "r13d", "r14d", "r15d",
    "r8w", "r9w", "r10w", "r11w", "r12w", "r13w", "r14w", "r15w",
    "r8b", "r9b", "r10b", "r11b", "r12b", "r13b", "r14b", "r15b",
    // x86-16
    "ax", "bx", "cx", "dx", "si", "di", "bp", "sp", "ip",
    // 8-bit
    "al", "ah", "bl", "bh", "cl", "ch", "dl", "dh",
    // x87 FPU
    "st", "st0", "st1", "st2", "st3", "st4", "st5", "st6", "st7",
    // MMX
    "mm0", "mm1", "mm2", "mm3", "mm4", "mm5", "mm6", "mm7",
    // SSE
    "xmm0", "xmm1", "xmm2", "xmm3", "xmm4", "xmm5", "xmm6", "xmm7",
    "xmm8", "xmm9", "xmm10", "xmm11", "xmm12", "xmm13", "xmm14", "xmm15",
    // AVX-512
    "zmm0", "zmm1", "zmm2", "zmm3", "zmm4", "zmm5", "zmm6", "zmm7",
    "zmm8", "zmm9", "zmm10", "zmm11", "zmm12", "zmm13", "zmm14", "zmm15",
    // ARM general
    "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12",
    "sp", "lr", "pc", "cpsr", "spsr",
    // ARM NEON
    "q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7",
    "q8", "q9", "q10", "q11", "q12", "q13", "q14", "q15",
    "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7",
    "d8", "d9", "d10", "d11", "d12", "d13", "d14", "d15",
    "d16", "d17", "d18", "d19", "d20", "d21", "d22", "d23",
    "d24", "d25", "d26", "d27", "d28", "d29", "d30", "d31",
    // RISC-V
    "zero", "ra", "gp", "tp", "t0", "t1", "t2", "t3", "t4", "t5", "t6",
    "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11",
    "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7",
    "ft0", "ft1", "ft2", "ft3", "ft4", "ft5", "ft6", "ft7", "ft8", "ft9", "ft10", "ft11",
    "fs0", "fs1", "fs2", "fs3", "fs4", "fs5", "fs6", "fs7", "fs8", "fs9", "fs10", "fs11",
    "fa0", "fa1", "fa2", "fa3", "fa4", "fa5", "fa6", "fa7",
  ]);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Track section state
    if (/^\.data\b/i.test(trimmed) || /^data\b/i.test(trimmed)) {
      inDataSection = true;
      inCodeSection = false;
      continue;
    }
    if (/^\.text\b/i.test(trimmed) || /^text\b/i.test(trimmed) ||
        /^\.code\b/i.test(trimmed) || /^code\b/i.test(trimmed)) {
      inDataSection = false;
      inCodeSection = true;
      continue;
    }

    // Skip section directives
    if (/^\.(section|bss|rodata|const)/i.test(trimmed)) continue;
    // Skip MASM model/stack directives
    if (/^\.(model|stack|386|486|586|686|mmx|xmm)/i.test(trimmed)) continue;
    if (/^\s*(?:model|stack)\s+/i.test(trimmed) && !/\S+\s+proc\b/i.test(trimmed)) continue;

    const lower = trimmed.toLowerCase();

    // --- Imports ---

    // MASM: extrn <name>:<type>
    const extrnMatch = /^\s*(?:extrn|extern)\s+(\w+)/i.exec(trimmed);
    if (extrnMatch) {
      imports.push(extrnMatch[1]);
      continue;
    }

    // NASM: extern <name>
    const externMatch = /^\s*%?\s*extern\s+(\w+)/i.exec(trimmed);
    if (externMatch) {
      imports.push(externMatch[1]);
      continue;
    }

    // MASM include: include <file>
    const includeMatch = /^\s*include\s+([\w.]+)/i.exec(trimmed);
    if (includeMatch) {
      imports.push(includeMatch[1]);
      continue;
    }

    // NASM/GAS include: %include "<file>" or .include "<file>"
    const pctIncludeMatch = /^\s*%?\s*include\s+["<]([^">]+)[">]/i.exec(trimmed);
    if (pctIncludeMatch) {
      imports.push(pctIncludeMatch[1]);
      continue;
    }
    const dotIncludeMatch = /^\s*\.include\s+["<]([^">]+)[">]/i.exec(trimmed);
    if (dotIncludeMatch) {
      imports.push(dotIncludeMatch[1]);
      continue;
    }

    // --- Public / Global (exports) ---
    const publicMatch = /^\s*(?:public|global)\s+(\w+)/i.exec(trimmed);
    if (publicMatch) {
      exports.push(publicMatch[1]);
      continue;
    }

    // --- Types ---

    // MASM struct: <Name> STRUC or struct <Name>
    const masmStructMatch = /^\s*(\w+)\s+struc\b/i.exec(trimmed);
    if (masmStructMatch) {
      types.push(masmStructMatch[1]);
      continue;
    }
    const masmStruct2Match = /^\s*struc\s+(\w+)/i.exec(trimmed);
    if (masmStruct2Match) {
      types.push(masmStruct2Match[1]);
      continue;
    }
    const masmStruct3Match = /^\s*(\w+)\s+struct\b/i.exec(trimmed);
    if (masmStruct3Match && !inDataSection) {
      // Make sure it's not a register name or directive
      if (!registerNames.has(masmStruct3Match[1].toLowerCase()) &&
          !/^\./.test(masmStruct3Match[1])) {
        types.push(masmStruct3Match[1]);
        continue;
      }
    }

    // --- Functions / Labels / Procedures ---

    // MASM PROC: <name> PROC
    const procMatch = /^\s*(\w+)\s+proc\b/i.exec(trimmed);
    if (procMatch) {
      const name = procMatch[1];
      if (!registerNames.has(name.toLowerCase()) && !/^\./.test(name)) {
        functions.push(name);
        exports.push(name);
        continue;
      }
    }

    // MASM: proc <name>
    const proc2Match = /^\s*proc\s+(\w+)/i.exec(trimmed);
    if (proc2Match) {
      const name = proc2Match[1];
      if (!registerNames.has(name.toLowerCase()) && !/^\./.test(name)) {
        functions.push(name);
        exports.push(name);
        continue;
      }
    }

    // NASM %macro: %macro <name> <argcount>
    const macroMatch = /^\s*%macro\s+(\w+)/i.exec(trimmed);
    if (macroMatch) {
      const name = macroMatch[1];
      if (!registerNames.has(name.toLowerCase())) {
        functions.push(name);
        continue;
      }
    }

    // GAS .macro: .macro <name>
    const dotMacroMatch = /^\s*\.macro\s+(\w+)/i.exec(trimmed);
    if (dotMacroMatch) {
      const name = dotMacroMatch[1];
      if (!registerNames.has(name.toLowerCase())) {
        functions.push(name);
        continue;
      }
    }

    // Labels: <name>: at the start of a line
    // Exclude register names and known directives
    if (/^(\w[\w.]*):/.test(trimmed)) {
      const labelMatch = /^(\w[\w.]*):/.exec(trimmed);
      if (labelMatch) {
        const name = labelMatch[1];
        const lowerName = name.toLowerCase();
        // Skip register names, known directive prefixes, and common segment names
        if (!registerNames.has(lowerName) &&
            !lowerName.startsWith(".") &&
            !/^(data|text|code|bss|rodata|const|model|stack|mmx|xmm|386|486|586|686)$/.test(lowerName) &&
            !/^(byte|word|dword|qword|tbyte|ptr|offset|seg|assume|end|ends|endp|label|this|near|far|flat|use16|use32|use64)$/.test(lowerName) &&
            !/^_+$/.test(name)) {
          functions.push(name);
        }
      }
    }
  }

  // Remove duplicates
  const uniqueFunctions = [...new Set(functions)];
  const uniqueTypes = [...new Set(types)];
  const uniqueImports = [...new Set(imports)];
  const uniqueExports = [...new Set(exports)];

  return { exports: uniqueExports, imports: uniqueImports, functions: uniqueFunctions, types: uniqueTypes };
}
