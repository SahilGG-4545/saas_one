import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const invalid = () => Object.assign(new Error('Invalid photo. Please send a supported photo again, or reply No Photo.'), {code:'INVALID_MEDIA'});
const DEFAULT_HOSTS = ['whatsapp-media-library-stg.s3.ap-south-1.amazonaws.com','whatsapp-media-library.s3.ap-south-1.amazonaws.com'];
export function validateMediaUrl(value, env=process.env) {
    let url;
    try { url=new URL(value); } catch {throw invalid();}
    const allowed=(env.WHATSAPP_MEDIA_ALLOWED_HOSTS || DEFAULT_HOSTS.join(',')).split(',').map(host=>host.trim().toLowerCase()).filter(Boolean);
    if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || isIP(url.hostname) || !allowed.includes(url.hostname.toLowerCase())) throw invalid();
    return url;
}
export function publicIPv4(address) {
    if(isIP(address)!==4)return false;
    const [a,b]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) ||
        (a===192&&(b===168||b===0)) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
}
export async function fetchPhoto(value,options={}) {
    const url=validateMediaUrl(value,options.env);
    const signal=AbortSignal.timeout(10000);
    const lookup=options.lookup || dnsLookup;
    let addresses;
    try {
        addresses=await Promise.race([lookup(url.hostname,{all:true,family:4}),new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(invalid()),{once:true}))]);
    } catch {throw invalid();}
    if(!Array.isArray(addresses) || !addresses.length || addresses.some(record=>!publicIPv4(record.address)))throw invalid();
    const address=addresses[0].address;
    // Pin the approved DNS result for this connection. Reject every redirect.
    return new Promise((resolve,reject)=>{
        const req=(options.request || httpsRequest)(url,{signal,family:4,headers:{Accept:'image/jpeg,image/png,image/webp,image/gif'},
            lookup:(_host,lookupOptions,callback)=>lookupOptions.all?callback(null,[{address,family:4}]):callback(null,address,4)},res=>{
            const max=10*1024*1024;
            if(res.statusCode!==200 || !/^image\/(jpeg|png|webp|gif)(?:;|$)/i.test(String(res.headers['content-type'] || '')) || Number(res.headers['content-length'])>max) {
                res.destroy();req.destroy();reject(invalid());return;
            }
            const chunks=[];let bytes=0;
            res.on('data',chunk=>{bytes+=chunk.length;if(bytes>max){res.destroy();req.destroy();reject(invalid());}else chunks.push(chunk);});
            res.on('error',()=>reject(invalid()));
            res.on('end',()=>bytes>0&&bytes<=max?resolve(Buffer.concat(chunks)):reject(invalid()));
        });
        req.on('error',()=>reject(invalid()));req.end();
    });
}
