'use client';
import {useState,type CSSProperties} from 'react';
type Person={id?:unknown;name?:unknown;has_photo?:unknown;photo_version?:unknown};
export function EmployeeAvatar({person,className='avatar',style}:{person:Person;className?:string;style?:CSSProperties}){
 const [failed,setFailed]=useState('');
 const name=String(person.name||''),id=String(person.id||''),version=String(person.photo_version||''),key=id+':'+version;
 const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
// eslint-disable-next-line @next/next/no-img-element -- private same-origin photo route that checks access; not an optimizable static asset
 return <span className={className+' employee-avatar'} style={style} aria-hidden="true">{person.has_photo&&id&&failed!==key?<img src={'/api/photos/'+encodeURIComponent(id)+(version?'?v='+encodeURIComponent(version):'')} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(key)}/>:initials}</span>;
}
