const axios=require('axios');const{VersionedTransaction}=require('@solana/web3.js');const{withRetry}=require('./executor');
function jupHeaders(cfg){const h={'Content-Type':'application/json'};const apiKey=(cfg?.jupiter?.apiKey||'').trim();if(apiKey)h['x-api-key']=apiKey;return h;}
async function swapOnce({connection,cfg,collectorKp,solMint,usdcMint,amountSOL,slippageBps}){
  const base=(cfg?.jupiter?.base||'https://lite-api.jup.ag').replace(/\/+$/,'');
  const amt=Math.floor(amountSOL*1e9);
  const quoteUrl=`${base}/swap/v1/quote?inputMint=${solMint}&outputMint=${usdcMint}&amount=${amt}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
  const q=await axios.get(quoteUrl,{timeout:10000,headers:jupHeaders(cfg)});
  const s=await axios.post(`${base}/swap/v1/swap`,{quoteResponse:q.data,userPublicKey:collectorKp.publicKey.toBase58(),wrapAndUnwrapSol:true,dynamicComputeUnitLimit:true,dynamicSlippage:{maxBps:slippageBps}},{timeout:20000,headers:jupHeaders(cfg)});
  if(!s?.data?.swapTransaction) throw new Error('jupiter: missing swapTransaction');
  const tx=VersionedTransaction.deserialize(Buffer.from(s.data.swapTransaction,'base64')); tx.sign([collectorKp]);
  const sig=await connection.sendTransaction(tx,{skipPreflight:false}); await connection.confirmTransaction(sig,'confirmed'); return sig;
}
async function swapSolToUsdcWithRetry(args){
  const cfg=args.cfg;
  return withRetry(()=>swapOnce(args),{retries:cfg?.retries?.jupiter??3,backoffMs:cfg?.retries?.backoffMs??4000,label:'jupiter swap'});
}
module.exports={swapSolToUsdcWithRetry};