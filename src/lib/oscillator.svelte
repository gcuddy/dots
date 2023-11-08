<script lang="ts">
	import { onMount } from 'svelte';
	import { spring } from 'svelte/motion';
	import type { Writable } from 'svelte/store';
	import { getAudioContext, getOscillatorNodesContext } from './ctx';

	export let active = false;
    export let highlighted = false;
    export let index: number;

	export function isActive() {
		return active;
	}

	let oscillator: OscillatorNode;
	export let x: number;
	export let y: number;

	let internal_x = x;
	let internal_y = y;

	$: if (active) {
		internal_x = x;
		internal_y = y;
	}

	let h = Math.random() * 360;
	let s = spring(25);
	let l = spring(75);

	function startingFrequency() {
		// get ~around 200
		return Math.random() * 400 + 100;
	}

	function endingFrequency() {
		// get ~around 600
		return Math.random() * 400 + 300;
	}

	let size = spring(10);
	let frequency = spring(startingFrequency(), {
		stiffness: 0.08,
		damping: 1,
		precision: 1
	});

	let volume = spring(0);

	const audio = getAudioContext();
	const nodes = getOscillatorNodesContext();
	console.log({ audio });

	let gainNode: GainNode;

	$: if (oscillator) {
		oscillator.frequency.value = $frequency;
	}

	$: if (gainNode) {
		gainNode.gain.value = $volume;
	}

	export function play() {
		oscillator = $audio.createOscillator();
		$nodes.push(oscillator);
		oscillator.type = 'triangle';
		oscillator.connect(gainNode);
		frequency.set(endingFrequency());
		// oscillator.frequency.value = $frequency;
		oscillator.start();
		size.set(30);
		s.set(100);
		l.set(50);
	}
	export function stop(disconnect = true) {
		size.set(10);
		if (disconnect) {
			frequency.set(0);
			volume.set(0);
			// setTimeout(() => {
			// 	oscillator.stop();
			// 	oscillator.disconnect();
			// }, 1000);
		}
	}

	$: if ($audio) {
		console.log({ $audio });
		gainNode = $audio.createGain();
		volume.set(0.1);
		gainNode.gain.value = $volume;
		gainNode.connect($audio.destination);
	}

	onMount(() => {
		// $audio = new window.AudioContext();
	});
</script>

<!-- You can only make one dot at a time -->

<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if $audio}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<circle
        data-index={index}
        on:click={(e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();


        }}
		style:fill="hsl({h}deg,{$s}%,{$l}%)"
		cx={active ? x : internal_x}
		cy={active ? y : internal_y}
		r={$size}
	/>
	{#if !active && highlighted}
		<foreignObject x={internal_x - 5} y={internal_y - 5} width="210" height="70" fill="black">
			<div class="stack">
                <label>
                    <span>size ({$size})</span>
                    <input bind:value={$size} type="range" min="1" max="50" step="0.01" />
                </label>
                <label>
                    <span>volume</span>
                    <input bind:value={$volume} type="range" min="0" max="0.5" step="0.01" />
                </label>
                <label>
                    <span>frequency</span>
                    <input bind:value={$frequency} type="range" min="100" max="1000" step="50" />
                </label>
            </div>
		</foreignObject>
	{/if}
{/if}

<style>
    .stack {
        display: flex;
        flex-direction: column;
    }
</style>
