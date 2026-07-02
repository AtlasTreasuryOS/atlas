const { Connection, PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const { createTransferCheckedInstruction, createMintToCheckedInstruction, createBurnCheckedInstruction } = require('@solana/spl-token');

function makeConnection(rpcUrl){ return new Connection(rpcUrl,'confirmed'); }

async function getSolBalance(connection,pubkey){ return (await connection.getBalance(pubkey))/1e9; }

async function getTokenBalance(connection,ata){ const res=await connection.getTokenAccountBalance(ata,'confirmed'); const {amount,decimals}=res.value; return { ui: Number(amount)/Math.pow(10,decimals), decimals }; }

async function getTokenSupply(connection,mint){ const res=await connection.getTokenSupply(mint,'confirmed'); const {amount,decimals}=res.value; return { ui: Number(amount)/Math.pow(10,decimals), decimals }; }

async function transferSol(connection, fromKp, toPubkey, sol){
  const lamports=Math.floor(sol*1e9);
  const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
  const tx=new Transaction().add(SystemProgram.transfer({fromPubkey:fromKp.publicKey,toPubkey,lamports}));
  tx.feePayer=fromKp.publicKey; tx.recentBlockhash=blockhash; tx.sign(fromKp);
  const sig=await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},'confirmed');
  return sig;
}

async function transferChecked(connection,{ownerKp,sourceAta,mint,destAta,amountUi,decimals}){
  const amount=Math.floor(amountUi*Math.pow(10,decimals));
  const ix=createTransferCheckedInstruction(sourceAta,mint,destAta,ownerKp.publicKey,BigInt(amount),decimals);
  const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
  const tx=new Transaction().add(ix); tx.feePayer=ownerKp.publicKey; tx.recentBlockhash=blockhash; tx.sign(ownerKp);
  const sig=await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},'confirmed');
  return sig;
}

async function transferCheckedMany(connection,{ownerKp,mint,decimals,transfers}){
  const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
  const tx=new Transaction(); tx.feePayer=ownerKp.publicKey; tx.recentBlockhash=blockhash;
  for(const t of (transfers||[])){
    const amt=Math.floor((t.amountUi||0)*Math.pow(10,decimals));
    if(amt<=0) continue;
    tx.add(createTransferCheckedInstruction(t.sourceAta,mint,t.destAta,ownerKp.publicKey,BigInt(amt),decimals));
  }
  if(tx.instructions.length===0) return null;
  tx.sign(ownerKp);
  const sig=await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},'confirmed');
  return sig;
}

async function mintToChecked(connection,{authorityKp,mint,destAta,amountUi,decimals}){
  const amount=Math.floor(amountUi*Math.pow(10,decimals));
  const ix=createMintToCheckedInstruction(mint,destAta,authorityKp.publicKey,BigInt(amount),decimals);
  const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
  const tx=new Transaction().add(ix); tx.feePayer=authorityKp.publicKey; tx.recentBlockhash=blockhash; tx.sign(authorityKp);
  const sig=await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},'confirmed');
  return sig;
}

async function burnChecked(connection,{authorityKp,mint,sourceAta,amountUi,decimals}){
  const amount=Math.floor(amountUi*Math.pow(10,decimals));
  const ix=createBurnCheckedInstruction(sourceAta,mint,authorityKp.publicKey,BigInt(amount),decimals);
  const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
  const tx=new Transaction().add(ix); tx.feePayer=authorityKp.publicKey; tx.recentBlockhash=blockhash; tx.sign(authorityKp);
  const sig=await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},'confirmed');
  return sig;
}

module.exports={ makeConnection, PublicKey, getSolBalance, getTokenBalance, getTokenSupply, transferSol, transferChecked, transferCheckedMany, mintToChecked, burnChecked };
