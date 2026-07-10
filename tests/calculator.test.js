import { describe, it, expect } from 'vitest';
import { systemTools } from '../src/js/modules/systemTools.js';

describe('Calculator Tool', () => {
    // Extract the calculator executeTool function
    const calcTool = systemTools.find(tool => tool.name === 'Calculator.js');

    // Create a function that creates the evaluate environment and runs the tool
    const runTool = async (args) => {
        // This simulates how the code is executed in the worker, but since we just have a string,
        // we can create a temporary function to test the logic
        const funcStr = calcTool.code.replace('async function executeTool(args, state) {', '');
        const body = funcStr.substring(0, funcStr.lastIndexOf('}'));
        const executeToolFn = new Function('args', 'state', body);
        return await executeToolFn(args, {});
    };

    it('should correctly evaluate simple addition', async () => {
        const result = await runTool({ expression: "2 + 2" });
        expect(result).toEqual({ result: 4 });
    });

    it('should handle decimals', async () => {
        const result = await runTool({ expression: "2.5 + 1.5" });
        expect(result).toEqual({ result: 4 });
    });

    it('should respect order of operations', async () => {
        const result = await runTool({ expression: "2 + 3 * 4" });
        expect(result).toEqual({ result: 14 });
    });

    it('should handle parentheses correctly', async () => {
        const result = await runTool({ expression: "(2 + 3) * 4" });
        expect(result).toEqual({ result: 20 });
    });

    it('should handle negative numbers', async () => {
        const result = await runTool({ expression: "-2 + 5" });
        expect(result).toEqual({ result: 3 });

        const result2 = await runTool({ expression: "5 * -2" });
        expect(result2).toEqual({ result: -10 });
    });

    it('should return error for empty expressions', async () => {
        const result = await runTool({ expression: "" });
        expect(result).toEqual({ error: "Invalid math expression characters." });
    });

    it('should return error for invalid characters', async () => {
        const result = await runTool({ expression: "2 + a" });
        expect(result).toEqual({ error: "Invalid math expression characters." });
    });

    it('should return error for invalid math syntax', async () => {
        // The regex check passes, but the parser should throw
        const result = await runTool({ expression: "2 + +" });
        expect(result.error).toBeDefined();

        const result2 = await runTool({ expression: "2 + (" });
        expect(result2.error).toBeDefined();
    });
});
