import { it } from 'vitest';
import { classifyCommand } from '../intents';
const S = process.env.PH ? process.env.PH.split('|') : [];
it('try', () => { for (const s of S) console.log(JSON.stringify(s), JSON.stringify(classifyCommand(s))); });
