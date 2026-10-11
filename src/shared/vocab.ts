// Shared shot and cut vocabulary. One definition for the app, the printed plan, the export
// and the agent, so a "MCU / push-in" means the same thing everywhere.

export interface Term<K extends string = string> {
  key: K;
  abbr: string;
  label: string;
  /** What it is. */
  definition: string;
  /** Why or when a creator might use it, in practical terms. */
  use: string;
  /** Where the creator's own Story Starter Kit guide covers this (page reference only). */
  kit?: string;
}

export const SHOT_SIZES = [
  { key: 'ews', abbr: 'EWS', label: 'Extreme wide', definition: 'The subject is small within a large landscape or space.', use: 'Establish where we are; show scale, distance and isolation.' },
  { key: 'ws', abbr: 'WS', label: 'Wide', definition: 'The whole subject and plenty of surroundings.', use: 'Set up a scene or location; show riders arriving or leaving.', kit: '16 Shots p.4' },
  { key: 'fs', abbr: 'FS', label: 'Full', definition: 'The subject fills the frame head to toe (or the whole bike).', use: 'Show a person with their bike or kit, and their body language.' },
  { key: 'mws', abbr: 'MWS', label: 'Medium wide', definition: 'From roughly the knees up.', use: 'Two people talking with some setting visible; a relaxed walk-and-talk.' },
  { key: 'ms', abbr: 'MS', label: 'Medium', definition: 'From roughly the waist up.', use: 'Conversation and pieces to camera; the everyday workhorse shot.', kit: '16 Shots p.5' },
  { key: 'mcu', abbr: 'MCU', label: 'Medium close-up', definition: 'From the chest up.', use: 'Reactions and speech where expression matters but context still helps.' },
  { key: 'cu', abbr: 'CU', label: 'Close-up', definition: 'A face or one object fills most of the frame.', use: 'Emotion, emphasis and reactions; a quick cutaway that hides edits.', kit: '16 Shots p.6' },
  { key: 'ecu', abbr: 'ECU', label: 'Extreme close-up / macro', definition: 'A tiny detail fills the frame: eyes, a gauge needle, tyre tread.', use: 'Texture and intensity; makes small things feel big.', kit: '16 Shots p.16' },
  { key: 'ins', abbr: 'INS', label: 'Insert / detail', definition: 'A close shot of an object or action, usually without a face.', use: 'Hands, straps, maps, signs, coffee: the details that make editing easy.' },
  { key: 'abstract', abbr: 'ABS', label: 'Abstract insert', definition: 'A very short, non-literal mood shot: light flare, water, dust, blur.', use: 'Rhythm and feeling between scenes; often under a second on screen.', kit: '16 Shots p.18' },
] as const satisfies readonly Term[];

export const SHOT_ANGLES = [
  { key: 'eye', abbr: 'EYE', label: 'Eye level', definition: 'Camera at the subject’s eye height.', use: 'Neutral and natural; the default for conversation.' },
  { key: 'high', abbr: 'HIGH', label: 'High angle', definition: 'Camera looks down on the subject.', use: 'Shows the layout of a place; can make a subject feel small.', kit: '16 Shots p.13' },
  { key: 'low', abbr: 'LOW', label: 'Low angle', definition: 'Camera looks up at the subject.', use: 'Makes bikes and riders feel bigger and more heroic.', kit: '16 Shots p.13' },
  { key: 'ground', abbr: 'GND', label: 'Ground level', definition: 'Camera on or near the ground.', use: 'Wheels, gravel and boots passing by; a dramatic sense of speed.' },
  { key: 'overhead', abbr: 'TOP', label: 'Top-down', definition: 'Looking straight down from above.', use: 'Maps, tables, packing layouts; a clean, graphic change of view.', kit: '16 Shots p.17' },
  { key: 'aerial', abbr: 'AER', label: 'Aerial', definition: 'From a drone or high vantage point.', use: 'Roads through landscape; reveals and route context.' },
  { key: 'pov', abbr: 'POV', label: 'Point of view', definition: 'What a rider or character sees.', use: 'Helmet or chest cam; puts the viewer on the bike.', kit: '16 Shots p.8' },
  { key: 'ots', abbr: 'OTS', label: 'Over the shoulder', definition: 'Framed past one person’s shoulder towards another person or a view.', use: 'Conversations and looking at a view or map together.', kit: '16 Shots p.7' },
  { key: 'dutch', abbr: 'DUT', label: 'Dutch angle', definition: 'The horizon is deliberately tilted.', use: 'Unease or energy; use sparingly.', kit: '16 Shots p.15' },
] as const satisfies readonly Term[];

export const SHOT_MOVEMENTS = [
  { key: 'static', abbr: 'STATIC', label: 'Static', definition: 'Locked-off camera, no movement.', use: 'Calm, observational; easiest to cut.' },
  { key: 'inframe', abbr: 'IN-FRAME', label: 'Movement in frame', definition: 'The camera stays still while the subject enters, passes or exits.', use: 'Bikes riding through a fixed view; shows progress without camera work.', kit: '16 Shots p.10' },
  { key: 'pan', abbr: 'PAN', label: 'Pan', definition: 'Camera turns left or right on a fixed point.', use: 'Follow a passing bike or sweep across a view.' },
  { key: 'tilt', abbr: 'TILT', label: 'Tilt', definition: 'Camera tilts up or down on a fixed point.', use: 'Reveal height: from a road up to a mountain, from boots to face.' },
  { key: 'push', abbr: 'PUSH', label: 'Push in', definition: 'Camera moves slowly towards the subject.', use: 'Build focus or emotion; draw attention to a detail.', kit: '16 Shots p.11' },
  { key: 'pull', abbr: 'PULL', label: 'Pull out', definition: 'Camera moves slowly away from the subject.', use: 'Reveal context or let a moment end.', kit: '16 Shots p.11' },
  { key: 'track', abbr: 'TRACK', label: 'Tracking / follow', definition: 'Camera travels with the subject: alongside, behind or ahead.', use: 'Riding alongside, following a walk; energy and momentum.', kit: '16 Shots p.9' },
  { key: 'walkaway', abbr: 'WALK-AWAY', label: 'Walk / ride away', definition: 'The subject leaves the camera, into the distance or out of frame.', use: 'Close a scene or chapter; a natural ending beat.', kit: '16 Shots p.12' },
  { key: 'body', abbr: 'BODY', label: 'Body-mounted (snorricam)', definition: 'Camera fixed to the subject, usually facing them, so the world moves around them.', use: 'Chest or bike mount facing the rider: intensity and immersion.', kit: '16 Shots p.14' },
  { key: 'handheld', abbr: 'HH', label: 'Handheld', definition: 'Hand-held, with natural movement.', use: 'Immediacy, realism and energy; vlog-style moments.', kit: '16 Shots p.19' },
  { key: 'zoom', abbr: 'ZOOM', label: 'Zoom', definition: 'Lens changes focal length; the camera stays put.', use: 'Quick emphasis; a deliberately observational feel.' },
  { key: 'aerial', abbr: 'AERIAL', label: 'Drone move', definition: 'A flying move: rise, orbit, follow or reveal.', use: 'Landscape reveals and following the road.' },
  { key: 'whip', abbr: 'WHIP', label: 'Whip pan', definition: 'A very fast pan that blurs.', use: 'Energetic transition between two places or moments.' },
] as const satisfies readonly Term[];

export const CUT_TYPES = [
  { key: 'cut', abbr: 'CUT', label: 'Straight cut', definition: 'One shot ends and the next begins immediately.', use: 'The default. Most cuts should be invisible straight cuts.' },
  { key: 'flow', abbr: 'FLOW', label: 'Flow cut', definition: 'Movement in one shot continues in the same direction in the next.', use: 'Bike exits frame right, enters next shot from the left; film both directions.', kit: '7 Cuts p.3' },
  { key: 'match', abbr: 'MATCH', label: 'Match cut', definition: 'Two shots linked by a matching shape, position or composition.', use: 'Wheel → sun; a face in one place → the same framing elsewhere. Plan both shots.', kit: '7 Cuts p.8' },
  { key: 'action', abbr: 'ACTION', label: 'Action cut', definition: 'Cut in the middle of a movement and continue it in the next shot.', use: 'Swinging a leg over the bike, clipping a buckle; film the action wide and close.', kit: '7 Cuts p.6' },
  { key: 'wmc', abbr: 'W-M-C', label: 'Wide → medium → close', definition: 'A basic sequence: where we are, what happens, what matters.', use: 'The safest way to cover any stop; reverse it for a reveal.', kit: '7 Cuts p.7' },
  { key: 'jcut', abbr: 'J-CUT', label: 'J-cut', definition: 'The next scene’s sound starts before its picture.', use: 'Hear the ferry horn before we see the port; pulls the viewer forward.' },
  { key: 'lcut', abbr: 'L-CUT', label: 'L-cut', definition: 'The current sound continues over the next picture.', use: 'Keep a conversation running over riding shots.' },
  { key: 'cutaway', abbr: 'CUTAWAY', label: 'Cutaway', definition: 'A brief shot of something else, then back.', use: 'Cover jumps in talk with details or reactions; film plenty of inserts.' },
  { key: 'jump', abbr: 'JUMP', label: 'Jump cut', definition: 'Same framing, forward in time.', use: 'Compress a long task (packing, fixing a strap) or tighten a piece to camera.', kit: '7 Cuts p.5' },
  { key: 'smash', abbr: 'SMASH', label: 'Smash cut', definition: 'An abrupt cut to a contrasting mood, place or sound.', use: 'Tone change or surprise: calm plan → pouring rain; drop the music.', kit: '7 Cuts p.4' },
  { key: 'cross', abbr: 'CROSS', label: 'Cross-cut', definition: 'Alternating between two things happening at the same time.', use: 'Two riders on different roads; preparation and destination.' },
  { key: 'montage', abbr: 'MONTAGE', label: 'Montage', definition: 'A sequence of short shots showing time passing.', use: 'A day of riding in 30 seconds; usually cut to music.' },
  { key: 'whip', abbr: 'WHIP', label: 'Whip-pan transition', definition: 'A whip pan at the end of one shot hides a cut into the next.', use: 'Energetic change of place; film the out and in whips.' },
  { key: 'dissolve', abbr: 'DISSOLVE', label: 'Dissolve', definition: 'One shot gradually blends into the next.', use: 'Passing of time or a softer, reflective change.' },
  { key: 'fade', abbr: 'FADE', label: 'Fade to / from black', definition: 'Picture fades to or from black.', use: 'Start or end the episode, or mark a new day.' },
] as const satisfies readonly Term[];

/** Pacing advice that applies to every cut (not a transition type of its own). */
export const PACING = {
  label: 'Speed of the cut',
  text: 'Cut faster for energy and tension, slower for calm and emotion. Vary the pace across the episode and let important moments breathe.',
  kit: '7 Cuts p.9',
};

export type ShotSize = (typeof SHOT_SIZES)[number]['key'];
export type ShotAngle = (typeof SHOT_ANGLES)[number]['key'];
export type ShotMovement = (typeof SHOT_MOVEMENTS)[number]['key'];
export type CutType = (typeof CUT_TYPES)[number]['key'];

export const keysOf = <T extends readonly Term[]>(list: T) => list.map((t) => t.key) as unknown as [T[number]['key'], ...T[number]['key'][]];

export function term<T extends readonly Term[]>(list: T, key: string | null | undefined): T[number] | undefined {
  return key ? list.find((t) => t.key === key) : undefined;
}

/** Compact vocabulary for agents: keys with definitions, used by the MCP guide tool. */
export function vocabularyForAgents() {
  const pick = (list: readonly Term[]) => list.map(({ key, abbr, label, definition, use }) => ({ key, abbr, label, definition, use }));
  return {
    shotSizes: pick(SHOT_SIZES),
    shotAngles: pick(SHOT_ANGLES),
    shotMovements: pick(SHOT_MOVEMENTS),
    cutTypes: pick(CUT_TYPES),
    pacing: PACING.text,
    guidance: [
      'Set a shot’s size, angle and movement when they matter for filming; leave them empty when any framing will do.',
      'Keep the free-text framing field for anything the vocabulary does not cover (e.g. "chest mount", "through the windscreen").',
      'Scene cutToNext is an editing intention for the rough cut, not a promise. Only plan a match cut or J/L-cut when the shots needed for it are on the list.',
      'Prefer a few useful shots: one wide to establish, one medium for people, inserts for cutaways.',
    ],
  };
}
