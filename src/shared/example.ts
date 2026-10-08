// Optional demo content: the MTA opening sequence from the brief. These are illustrative
// planning values, not a report of filmed footage.
import type { Operation } from './ops.js';

export const EXAMPLE_TITLE = 'Heading for the mountains';

export const EXAMPLE_BRIEF =
  'Opening sequence for a motorcycle trip episode: two riders pack, load the trailer and head for the mountains, stopping for fuel and coffee on the way.';

export function exampleOperations(): Operation[] {
  return [
    {
      op: 'updateEpisode',
      fields: { brief: EXAMPLE_BRIEF, targetSeconds: 600 },
    },
    {
      op: 'addScene',
      scene: {
        title: 'Packing for the ride',
        durationSeconds: 45,
        description: 'Two riders pack their bags, check their gear and prepare the bikes for departure.',
        purpose: 'Meet the riders and build anticipation for the trip.',
        audio: 'Natural sound: zips, buckles, tools.',
        location: 'Home garage',
        shots: [
          { framing: 'Wide', description: 'Both riders and bikes in the packing area', priority: 'essential' },
          { framing: 'Close-up', description: 'Hands fastening a bag and checking gear', priority: 'essential' },
          { framing: 'Medium', description: 'A brief exchange about the trip ahead', priority: 'optional' },
        ],
      },
    },
    {
      op: 'addScene',
      scene: {
        title: 'Loading the trailer',
        durationSeconds: 30,
        description: 'The bikes go up the ramp and are strapped down for the drive.',
        purpose: 'Introduce the riders and what they hope to get from the trip.',
        voiceover: 'Ask each rider: "What are you most looking forward to?" Capture the real answer; do not script it.',
        location: 'Home garage',
        shots: [
          { framing: 'Wide', description: 'Both riders loading a bike up the ramp', priority: 'essential' },
          { framing: 'Detail', description: 'Straps tightening on the bike', priority: 'essential' },
          {
            framing: 'Medium',
            description: 'Brief answer to "What are you most looking forward to?"',
            cameraNotes: 'Capture the answer as it comes; revisit it in a later scene once the trip has happened.',
            priority: 'essential',
          },
        ],
      },
    },
    {
      op: 'addScene',
      scene: {
        title: 'The road to the mountains',
        durationSeconds: 60,
        description: 'Departure and the landscape changing from town to hills.',
        purpose: 'Give the viewer a sense of distance and rising anticipation.',
        location: 'On the road',
        shots: [
          { framing: 'Wide', description: 'Departure from the house', priority: 'essential' },
          { framing: 'Wide', description: 'Changing landscape through the windscreen', priority: 'essential' },
          { framing: 'Insert', description: 'Route map or sat-nav insert', priority: 'optional' },
        ],
      },
    },
    {
      op: 'addScene',
      scene: {
        title: 'Fuel and coffee stop',
        durationSeconds: 30,
        description: 'A short stop to refuel and grab a coffee before the mountain roads.',
        location: 'Fuel station',
        shots: [
          { framing: 'Wide', description: 'Arrival at the fuel station', priority: 'essential' },
          { framing: 'Close-up', description: 'Coffee detail', priority: 'optional' },
          { framing: 'Medium', description: 'Brief rider conversation', priority: 'essential' },
        ],
      },
    },
  ];
}
