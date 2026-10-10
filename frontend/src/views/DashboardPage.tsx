import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { service } from '../../wailsjs/go/models'
import { api, allPages } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { fmtDate, fmtDateShort, monthLabel } from '../lib/format'
import { Badge, Card, Empty, Loading, Money, Seg, StatusBadge, ViewHead } from '../components/ui'
import { HBars, TimeCompare } from '../components/charts'

type Row = Record<string, any>
type Period = 'month' | 'quarter' | 'year' | 'total'

export function DashboardPage() {
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const navigate = useNavigate()
  const [period,setPeriod]=useState<Period>('month'),[offset,setOffset]=useState(0)
  const now = new Date()
  now.setMonth(now.getMonth()+offset*(period==='month'?1:period==='quarter'?3:12))
  const anchor = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  const queryKey = `${period}-${anchor}-${currency}-${revision}`
  const [snapshot,setSnapshot]=useState<{key:string;data:Row;receivables:Row[];clients:Row[]}|null>(null)
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    let active=true
    setLoading(true)
    const open = new service.Filter({field:'balance',op:'>',value:0})
    void Promise.all([api.Dashboard.GetDashboard(period,anchor,currency),allPages(api.Sales.List,currency,[open]),allPages(api.Catalog.ListClients,currency)])
      .then(([data,receivables,clients])=>{if(active){setSnapshot({key:queryKey,data:data as Row,receivables,clients});setLoading(false)}})
      .catch(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[queryKey])
  const data=snapshot?.key===queryKey?snapshot.data:null
  const receivables=snapshot?.key===queryKey?snapshot.receivables:[]
  const clients=snapshot?.key===queryKey?snapshot.clients:[]
  const receivableGroups=groupMonths(receivables)
  const series=(data?.series??[]).map((row:Row)=>({label:monthLabel(row.month).slice(0,3),a:Number(row.sales),b:Number(row.costBase)+Number(row.costExtra),line:Number(row.profit)}))
  const totalReceivables=receivables.reduce((sum,row)=>sum+Number(row.balanceCents??0),0)
  const totalSales=Number(data?.sales??0), totalCost=Number(data?.costBase??0)+Number(data?.costExtra??0)
  return <>
    <ViewHead title="Inicio" subtitle={`Resumen del período · ${monthLabel(anchor)} · montos en ${currency==='PEN'?'S/':'$'}`} actions={<><div className="hstack"><button type="button" className="iconbtn" aria-label="Período anterior" onClick={()=>setOffset((value)=>value-1)}><ChevronLeft size={15}/></button><button type="button" className="iconbtn" aria-label="Período siguiente" disabled={period==='total'||offset>=0} onClick={()=>setOffset((value)=>Math.min(0,value+1))}><ChevronRight size={15}/></button></div><Seg label="Período del resumen" options={[{value:'month',label:'Mes'},{value:'quarter',label:'Trimestre'},{value:'year',label:'Año'},{value:'total',label:'Total'}]} value={period} onChange={(value)=>{setPeriod(value);setOffset(0)}}/></>}/>
    {loading||!data?<Loading/>:<>
      <div className="kpis"><div className="kpi kpi--accent"><span className="kpi__label">Ventas</span><span className="kpi__value"><Money cents={data.sales}/></span><div className="kpi__foot"><span className="kpi__sub">ventas y envíos vigentes del período</span></div></div><div className="kpi"><span className="kpi__label">Costos</span><span className="kpi__value"><Money cents={totalCost}/></span><div className="kpi__foot"><span className="kpi__sub">base <Money cents={data.costBase} className="money--inline"/> · extras <Money cents={data.costExtra} className="money--inline"/></span></div></div><div className="kpi kpi--accent"><span className="kpi__label">Utilidad</span><span className="kpi__value"><Money cents={data.profit}/></span><div className="kpi__foot"><span className="kpi__sub">{totalSales>0?`${(Number(data.profit)/totalSales*100).toFixed(1)} % sobre ventas`:'sin ventas en el período'}</span></div></div><div className="kpi"><span className="kpi__label">Por cobrar</span><span className="kpi__value"><Money cents={totalReceivables}/></span><div className="kpi__foot"><span className="kpi__sub">{receivables.length} ventas/envíos con saldo</span></div></div></div>
      <div className="grid-dash">
        <Card title="Ventas − Costo base − Costos extras = Utilidad" subtitle="Barras agrupadas por mes · detalle al pasar el cursor" className="span8">{series.length?<TimeCompare data={series} aLabel="Ventas" bLabel="Costos" lineLabel="Utilidad"/>:<Empty>Sin datos en el período</Empty>}</Card>
        <Card title="Desglose de costos" subtitle="Base de lotes vendidos + extras prorrateados por unidades vendidas" className="span4"><div className="statline"><div><span>Base (lotes)</span><b><Money cents={data.costBase}/></b></div><div><span>Extras</span><b><Money cents={data.costExtra}/></b></div></div>{data.extrasByConcept?.length?<HBars items={data.extrasByConcept.slice(0,6).map((row:Row)=>({label:row.concept,value:Number(row.amount)}))} fmt={(value)=> <Money cents={value}/>}/>:<Empty>Sin extras en el período</Empty>}</Card>
        <Card title="Cuentas por cobrar" subtitle="Ventas y envíos con saldo, agrupados por mes" className="span6" flush>{!receivableGroups.length&&<Empty>Todo cobrado</Empty>}{receivableGroups.map(([month,rows])=><section className="jmonth" key={month}><header className="jmonth__head"><h2>{monthLabel(month)}</h2><span className="jmonth__stats">Total <Money cents={rows.reduce((sum,row)=>sum+Number(row.balanceCents??0),0)}/></span></header>{rows.map((row)=><button key={row.code} type="button" className={`listrow listrow--click ${statusView('sales',row.status)?`stripe stripe--${statusView('sales',row.status)?.tone}`:''}`} onClick={()=>navigate(`/${row.kind==='shipment'?'envios':'ventas'}?abrir=${encodeURIComponent(row.code)}`)}><span className="listrow__main"><span className="listrow__title">{row.code} · {clients.find((client)=>Number(client.id)===Number(row.client_id))?.name??'Cliente general'}</span><span className="listrow__meta">{fmtDateShort(row.date)}</span></span><span className="listrow__amount"><Money cents={row.balanceCents}/></span><StatusBadge state={statusView('sales',row.status)}/></button>)}</section>)}</Card>
        <Card title="Lotes en remate" subtitle="Lotes con stock disponible que superaron su cuenta regresiva" className="span6" flush>{!data.auctions?.length&&<Empty>Sin lotes en remate</Empty>}{(data.auctions??[]).map((row:Row)=><button key={row.id} type="button" className="listrow listrow--click stripe stripe--red" onClick={()=>navigate(`/inventario?tab=lots&lote=${row.id}`)}><span className="listrow__main"><span className="listrow__title">{row.product}</span><span className="listrow__meta">{row.code} · ingresado {fmtDateShort(row.entryDate)}</span></span><span className="listrow__amount">{row.available} uds</span><span className="listrow__sub">{row.daysInAuction} días en remate</span><StatusBadge state={statusView('lots','auction')}/></button>)}</Card>
        <Card title="Alertas ligeras" subtitle="Compras pendientes · ciclos por pagar o vencidos · ventas atrasadas" className="span6" flush><Alerts data={data.alerts??{}} navigate={navigate}/></Card>
      </div>
    </>}
  </>
}

function groupMonths(rows:Row[]):Array<[string,Row[]]>{const groups=new Map<string,Row[]>();for(const row of rows){const month=String(row.date).slice(0,7);groups.set(month,[...(groups.get(month)??[]),row])}return [...groups.entries()].sort((a,b)=>b[0].localeCompare(a[0]))}

function Alerts({data,navigate}:{data:Row;navigate:(path:string)=>void}){
  const rows=[...(data.pendingPurchases??[]).map((row:Row)=>({...row,label:`${row.code} sigue pendiente`,kind:'purchase'})),...(data.cardCycles??[]).map((row:Row)=>({...row,label:`${row.cardName} · ciclo ${fmtDate(row.cycleEnd)}`,kind:'cycle'})),...(data.overdueSales??[]).map((row:Row)=>({...row,label:`${row.code} atrasada`,kind:row.kind==='shipment'?'shipment':'sale'}))]
  if(!rows.length)return <Empty>Sin alertas</Empty>
  return <>{rows.map((row,index)=>{const path=row.kind==='purchase'?`/compras?abrir=${encodeURIComponent(row.code)}`:row.kind==='cycle'?`/tarjetas?cardId=${row.cardId}&cycleEnd=${row.cycleEnd}`:`/${row.kind==='shipment'?'envios':'ventas'}?abrir=${encodeURIComponent(row.code)}`;return <button key={`${row.kind}-${row.id??row.code}-${index}`} className={`listrow listrow--click ${row.kind==='purchase'?'stripe stripe--amber':row.kind==='cycle'?'stripe stripe--red':'stripe stripe--red'}`} type="button" onClick={()=>navigate(path)}><span className="listrow__main"><span className="listrow__title">{row.label}</span><span className="listrow__meta">{fmtDate(row.date??row.dueDate)}</span></span><Badge tone={row.kind==='purchase'?'amber':'red'}>{row.kind==='cycle'?'tarjeta':row.kind==='purchase'?'compra':row.kind==='shipment'?'envío':'venta'}</Badge></button>})}</>
}
