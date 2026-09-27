import {TYPE, packet, profilePacket, input, read, states, roomRequest, readRoom} from '../../client/src/shared/protocol.js';

const testPort = Number(process.env.PORT || 3000);
const testUrl = `ws://127.0.0.1:${testPort}/play`;
console.log(`Testing live multiplayer with 2 clients on ${testUrl}...`);

async function testMultiplayer() {
  const ws1 = new WebSocket(testUrl);
  const ws2 = new WebSocket(testUrl);

  let p1Connected = false, p2Connected = false;
  let p1Snapshots = 0, p2Snapshots = 0;
  let p1Id = 0, p2Id = 0;
  let sawSixthBoard = false;
  let roomCode = '';
  let resolveRoom;
  const roomCreated = new Promise(resolve => { resolveRoom = resolve; });

  await Promise.all([
    new Promise((resolve, reject) => {
      ws1.binaryType = 'arraybuffer';
      ws1.onopen = () => {
        p1Connected = true;
        // Send profile
        ws1.send(profilePacket({nick: 'Surfer Alpha', character: 1, board: 2}));
        resolve();
      };
      ws1.onerror = reject;
    }),
    new Promise((resolve, reject) => {
      ws2.binaryType = 'arraybuffer';
      ws2.onopen = () => {
        p2Connected = true;
        // Send profile
        ws2.send(profilePacket({nick: 'Surfer Beta', character: 3, board: 5}));
        resolve();
      };
      ws2.onerror = reject;
    })
  ]);

  console.log('Both clients connected and sent profile packets.');

  // Create a real shared room so both profiles appear in authoritative snapshots.
  ws1.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      const v = read(event.data);
      const type = v.getUint8(1);
      if (type === TYPE.ROOM_STATE && !roomCode) {
        roomCode = readRoom(v).code;
        resolveRoom();
      }
      if (type === TYPE.SNAPSHOT) {
        p1Snapshots++;
        if (states(v).some(player => player.board === 5)) sawSixthBoard = true;
      }
      if (type === TYPE.WELCOME) {
        p1Id = v.getUint32(12, true);
      }
    }
  };

  ws2.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      const v = read(event.data);
      const type = v.getUint8(1);
      if (type === TYPE.SNAPSHOT) p2Snapshots++;
      if (type === TYPE.WELCOME) {
        p2Id = v.getUint32(12, true);
      }
    }
  };

  ws1.send(roomRequest(1, 0, '', 2));
  await Promise.race([roomCreated, new Promise((_, reject) => setTimeout(() => reject(Error('Room creation timed out')), 2000))]);
  ws2.send(roomRequest(2, 0, roomCode, 2));
  // Wait a moment for the join packet, then start the shared race.
  await new Promise(r => setTimeout(r, 200));
  ws1.send(packet(TYPE.ROOM_START, 12).buffer);

  // Send input packets for 1.5 seconds
  for (let i = 1; i <= 45; i++) {
    ws1.send(input(i, 0.2, 0));
    ws2.send(input(i, -0.2, 1));
    await new Promise(r => setTimeout(r, 33));
  }

  console.log(`P1 received ${p1Snapshots} packets (ID: ${p1Id}), P2 received ${p2Snapshots} packets (ID: ${p2Id}).`);

  ws1.close();
  ws2.close();

  if (p1Snapshots > 0 && p2Snapshots > 0 && sawSixthBoard) {
    console.log('SUCCESS: Live multiplayer verification passed! Binary uWebSockets snapshots exchanged.');
  } else {
    throw new Error('Failed to receive snapshots on both clients');
  }
}

testMultiplayer().catch(err => {
  console.error('Multiplayer test error:', err);
  process.exit(1);
});
