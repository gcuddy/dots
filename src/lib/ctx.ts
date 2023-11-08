import { getContext, setContext } from 'svelte';
import type { Readable, Writable } from 'svelte/store';

export function getAudioContext(): Readable<AudioContext> {
	const ctx = getContext('audio_context');
	if (!ctx) {
		throw new Error('AudioContext not found');
	}
	return ctx as Readable<AudioContext>;
}

export function setAudioContext(ctx: Readable<AudioContext>) {
	setContext('audio_context', ctx);
}

export function getOscillatorNodesContext(): Writable<Array<OscillatorNode>> {
	const ctx = getContext('oscillator_nodes');
	if (!ctx) {
		throw new Error('OscillatorNodes not found');
	}
	return ctx as Writable<Array<OscillatorNode>>;
}

export function setOscillatorNodesContext(ctx: Writable<Array<OscillatorNode>>) {
	setContext('oscillator_nodes', ctx);
}
