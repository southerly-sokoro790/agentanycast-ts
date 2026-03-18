import { describe, it, expect } from "vitest";
import basex from "base-x";
import { peerIdToDIDKey, didKeyToPeerId } from "../src/did.js";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const bs58 = basex(BASE58_ALPHABET);

function makePeerId(pubkey: Uint8Array): string {
  // protobuf: field 1 (KeyType=Ed25519=1) = 0x08 0x01, field 2 (Data) = 0x12 <len> <data>
  const proto = new Uint8Array(4 + pubkey.length);
  proto[0] = 0x08;
  proto[1] = 0x01;
  proto[2] = 0x12;
  proto[3] = pubkey.length;
  proto.set(pubkey, 4);

  // Identity multihash: 0x00 <length> <data>
  const mh = new Uint8Array(2 + proto.length);
  mh[0] = 0x00;
  mh[1] = proto.length;
  mh.set(proto, 2);

  return bs58.encode(mh);
}

function makeDIDKey(pubkey: Uint8Array): string {
  const mc = new Uint8Array(2 + pubkey.length);
  mc[0] = 0xed;
  mc[1] = 0x01;
  mc.set(pubkey, 2);
  return "did:key:z" + bs58.encode(mc);
}

describe("peerIdToDIDKey", () => {
  it("converts valid Ed25519 PeerID", () => {
    const pubkey = new Uint8Array(32).fill(0).map((_, i) => i);
    const peerId = makePeerId(pubkey);
    const did = peerIdToDIDKey(peerId);
    expect(did.startsWith("did:key:z")).toBe(true);
  });

  it("has correct multibase prefix", () => {
    const pubkey = new Uint8Array(32);
    const peerId = makePeerId(pubkey);
    const did = peerIdToDIDKey(peerId);
    expect(did[8]).toBe("z");
  });
});

describe("didKeyToPeerId", () => {
  it("converts valid did:key", () => {
    const pubkey = new Uint8Array(32).fill(0).map((_, i) => i);
    const did = makeDIDKey(pubkey);
    const peerId = didKeyToPeerId(did);
    expect(peerId.length).toBeGreaterThan(0);
  });

  it("rejects invalid prefix", () => {
    expect(() => didKeyToPeerId("not-a-did")).toThrow("Invalid did:key format");
  });

  it("rejects too-short payload", () => {
    const short = bs58.encode(Uint8Array.from([0xed, 0x01, 0x00]));
    expect(() => didKeyToPeerId(`did:key:z${short}`)).toThrow("too short");
  });

  it("rejects wrong multicodec", () => {
    const wrong = new Uint8Array(34);
    wrong[0] = 0x00;
    wrong[1] = 0x01;
    const encoded = bs58.encode(wrong);
    expect(() => didKeyToPeerId(`did:key:z${encoded}`)).toThrow("Unsupported multicodec");
  });
});

describe("round-trip", () => {
  it("PeerID -> did:key -> PeerID", () => {
    const pubkey = new Uint8Array(32).fill(0).map((_, i) => i);
    const peerId = makePeerId(pubkey);
    const did = peerIdToDIDKey(peerId);
    const recovered = didKeyToPeerId(did);
    expect(recovered).toBe(peerId);
  });

  it("did:key -> PeerID -> did:key", () => {
    const pubkey = new Uint8Array(32).fill(0).map((_, i) => i);
    const did = makeDIDKey(pubkey);
    const peerId = didKeyToPeerId(did);
    const recovered = peerIdToDIDKey(peerId);
    expect(recovered).toBe(did);
  });

  it("multiple keys round-trip", () => {
    for (let i = 0; i < 10; i++) {
      const pubkey = new Uint8Array(32).fill(0).map((_, j) => (i * 7 + j) % 256);
      const peerId = makePeerId(pubkey);
      const did = peerIdToDIDKey(peerId);
      const recovered = didKeyToPeerId(did);
      expect(recovered).toBe(peerId);
    }
  });

  it("consistent with known key", () => {
    const pubkey = new Uint8Array(32); // all zeros
    const peerId = makePeerId(pubkey);
    const did = makeDIDKey(pubkey);
    expect(peerIdToDIDKey(peerId)).toBe(did);
    expect(didKeyToPeerId(did)).toBe(peerId);
  });
});
