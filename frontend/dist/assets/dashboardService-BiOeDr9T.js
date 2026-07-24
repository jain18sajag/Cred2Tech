import{d as e,b as t}from"./index-DMP4Edla.js";/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const o=e("Coins",[["circle",{cx:"8",cy:"8",r:"6",key:"3yglwk"}],["path",{d:"M18.09 10.37A6 6 0 1 1 10.34 18",key:"t5s6rm"}],["path",{d:"M7 6h1v4",key:"1obek4"}],["path",{d:"m16.71 13.88.7.71-2.82 2.82",key:"1rbuyh"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=e("TrendingDown",[["polyline",{points:"22 17 13.5 8.5 8.5 13.5 2 7",key:"1r2t7k"}],["polyline",{points:"16 17 22 17 22 11",key:"11uiuu"}]]),c=async(a,s={})=>(await t.get("/dashboard/dsa/summary",{params:{period:a,...s}})).data,m=async()=>(await t.get("/dashboard/dsa/wallet")).data,p=async(a,s={})=>(await t.get("/dashboard/dsa/cases",{params:{period:a,...s}})).data,g=async(a,s={})=>(await t.get("/dashboard/dsa/stage-summary",{params:{period:a,...s}})).data,y=async(a,s={})=>(await t.get("/dashboard/platform/summary",{params:{period:a,...s}})).data,i=async(a,s={})=>(await t.get("/dashboard/platform/api-usage",{params:{period:a,...s}})).data,u=async(a,s={})=>(await t.get("/dashboard/platform/funnel",{params:{period:a,...s}})).data,l=async(a,s={})=>(await t.get("/dashboard/platform/top-dsas",{params:{period:a,...s}})).data,h=async(a,s={})=>(await t.get("/dashboard/platform/top-lenders",{params:{period:a,...s}})).data;export{o as C,d as T,m as a,p as b,g as c,y as d,i as e,u as f,c as g,l as h,h as i};
