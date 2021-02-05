import { testInterface } from 'stack-layer-lib';
export async function handler(input) {
    console.log('Handler');
    const test = {} as testInterface;
    return test;
}