import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const kp = Keypair.generate();
console.log('Public Key:', kp.publicKey.toBase58());
console.log('Secret Key (base58):', bs58.encode(kp.secretKey));
