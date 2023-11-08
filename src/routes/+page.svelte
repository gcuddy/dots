<script lang="ts">
	import { setAudioContext, setOscillatorNodesContext } from '$lib/ctx';
	import Oscillator from '$lib/oscillator.svelte';
	import { onMount } from 'svelte';
	import { spring } from 'svelte/motion';
	import { writable, type Writable } from 'svelte/store';

	let coords = spring(
		{ x: 50, y: 50 },
		{
			stiffness: 0.1,
			damping: 0.25
		}
	);

	let persist = false;

	let size = spring(10);
	let frequency = spring(200, {
		stiffness: 0.08,
		damping: 1,
		precision: 1
	});

	let audio: Writable<AudioContext> = writable();
	setAudioContext(audio);
	let oscillator: OscillatorNode;
	let gainNode: GainNode;

	$: if (oscillator) {
		oscillator.frequency.value = $frequency;
	}

	let highlightedIndex = -1;

	let oscillatorNodes = writable<OscillatorNode[]>([]);
	setOscillatorNodesContext(oscillatorNodes);

	let oscillators: Oscillator[] = [];
	let oscillateCoordinates: { x: number; y: number }[] = [];
	let activeOscillatorIndex = 0;

	onMount(() => {
		$audio = new window.AudioContext();
		gainNode = $audio.createGain();
		gainNode.gain.value = 0.1;
		gainNode.connect($audio.destination);
	});

	let nonSvgEvent = false;
</script>

<!-- You can only make one dot at a time -->

<!-- <div>Container</div> -->

<div style="position: absolute; top:1em; right: 1em;">
	<!-- <label>
		<h3>stiffness ({frequency.stiffness})</h3>
		<input bind:value={frequency.stiffness} type="range" min="0" max="1" step="0.01" />
	</label>

	<label>
		<h3>damping ({frequency.damping})</h3>
		<input bind:value={frequency.damping} type="range" min="0" max="1" step="0.01" />
	</label>
	<label>
		<h3>precision ({frequency.precision})</h3>
		<input bind:value={frequency.precision} type="range" min="0" max="10" step="0.01" />
	</label> -->
	<label>
		<h3>persist</h3>
		<input bind:checked={persist} type="checkbox" />
	</label>
	<div>
		<button
			on:click={() => {
				$oscillatorNodes.forEach((node) => {
					node.stop();
				});
				oscillators = [];
			}}>Clear</button
		>
	</div>
</div>

<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if audio}
	<svg
		on:mousemove={(e) => coords.set({ x: e.clientX, y: e.clientY })}
		on:mousedown={(e) => {
			if (e.target?.tagName !== 'svg') {
				const index = e.target.dataset?.index;
				if (index) {
					highlightedIndex = +index;
                    if (+index !== activeOscillatorIndex) {
                        nonSvgEvent = true;
                    }
				}
			}
			oscillators[activeOscillatorIndex].play();
			// oscillator = $audio.createOscillator();
			// oscillator.type = 'triangle';
			// oscillator.connect(gainNode);
			// frequency.set(600);
			// // oscillator.frequency.value = $frequency;
			// oscillator.start();
			// size.set(30);
		}}
		on:mouseup={(e) => {
			// if (e.target?.tagName !== 'svg') return;
			if (nonSvgEvent) {
				nonSvgEvent = false;
				return;
			}
			highlightedIndex = -1;
			if (persist) {
				oscillators.length = oscillators.length + 1;
				activeOscillatorIndex++;
				// oscillators[activeOscillatorIndex].stop(false);
			} else {
				oscillators[activeOscillatorIndex].stop();
			}
			// size.set(10);
			// frequency.set(0);
			// setTimeout(() => {
			// 	oscillator.stop();
			// }, 1000);
		}}
	>
		<Oscillator
			active={activeOscillatorIndex === 0}
			bind:this={oscillators[0]}
			index={0}
			x={$coords.x}
			y={$coords.y}
			highlighted={highlightedIndex === 0}
		/>
		{#each oscillators.slice(1) as oscillator, i}
			<Oscillator
				index={i + 1}
				highlighted={highlightedIndex === i + 1}
				active={activeOscillatorIndex === i + 1}
				bind:this={oscillators[i + 1]}
				x={$coords.x}
				y={$coords.y}
			/>
		{/each}
		<!-- <circle cx={$coords.x} cy={$coords.y} r={$size} /> -->
	</svg>
{/if}

<style>
	/* div {
		width: 800px;
		height: 600px;
		border: 1px solid;
	} */
	:global(body) {
		height: 100vh;
	}
	svg {
		width: 100%;
		height: 100%;
		margin: -8px;
	}
	circle {
		fill: #ff3e00;
	}
</style>
