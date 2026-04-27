"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
  ZoomableGroup,
} from "react-simple-maps";
import { cn } from "@/lib/utils";
import type { TravelLog, WishItem } from "@/store/useAppStore";
import type { UserRole } from "@/lib/userRole";
import { isUserRole } from "@/lib/userRole";
import { formatWishCardHeader } from "@/lib/wishDateFormat";
import {
  CITY_COORDS,
  INITIAL_MAP_CITIES,
  CAPITAL_CITIES,
  matchCityFromLocation,
} from "@/lib/mapCities";
import { supabaseBearerHeaders } from "@/lib/supabase/apiSessionHeaders";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const CHINA_ID = "156";

/** 地图基色 */
const MAP_FILL = "#FFDBFD";
/** 点亮区域颜色 */
const MAP_FILL_LIT = "#C9BEFF";
const MAP_STROKE = "rgba(255,255,255,0.5)";

const geographyStyle = {
  default: { outline: "none" as const },
  hover: { outline: "none" as const },
  pressed: { outline: "none" as const },
};

type GeographyGeom = { rsmKey: string; id?: string; properties: Record<string, unknown>; svgPath: string };

export function ChinaMapTravel(props: {
  /** 当前登录身份，用于 GET /api/travel-logs（地图数据仅以接口为准） */
  userId: UserRole;
  /** 已达成心愿：按「想去的地方」匹配城市点亮，悬停展示与旅行日志一致的「日期」「旅行随笔」 */
  completedWishes?: WishItem[];
  className?: string;
}) {
  const [travelLogs, setTravelLogs] = useState<TravelLog[]>([]);

  useEffect(() => {
    if (!isUserRole(props.userId)) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await supabaseBearerHeaders();
        if (!(headers as Record<string, string>).Authorization) return;
        const res = await fetch("/api/travel-logs", {
          cache: "no-store",
          headers: { ...headers },
        });
        let data: { ok?: boolean; travelLogs?: TravelLog[] };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          return;
        }
        if (cancelled || !res.ok || !data.ok || !Array.isArray(data.travelLogs)) return;
        setTravelLogs(data.travelLogs);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.userId]);

  const [tooltip, setTooltip] = useState<{
    clientX: number;
    clientY: number;
    city: string;
    logs: TravelLog[];
    wishes: WishItem[];
  } | null>(null);

  const cityToLogs = useMemo(() => {
    const map = new Map<string, TravelLog[]>();
    for (const city of INITIAL_MAP_CITIES) {
      map.set(city, []);
    }
    for (const log of travelLogs) {
      const city = matchCityFromLocation(log.locationText);
      if (city && CITY_COORDS[city]) {
        if (!map.has(city)) map.set(city, []);
        map.get(city)!.push(log);
      }
    }
    return map;
  }, [travelLogs]);

  const cityToWishes = useMemo(() => {
    const map = new Map<string, WishItem[]>();
    const list = props.completedWishes ?? [];
    for (const w of list) {
      if (!w.isCompleted || !w.place?.trim()) continue;
      const city = matchCityFromLocation(w.place);
      if (city && CITY_COORDS[city]) {
        if (!map.has(city)) map.set(city, []);
        map.get(city)!.push(w);
      }
    }
    return map;
  }, [props.completedWishes]);

  const allCities = useMemo(() => {
    const set = new Set<string>(INITIAL_MAP_CITIES);
    cityToLogs.forEach((_, city) => set.add(city));
    cityToWishes.forEach((_, city) => set.add(city));
    return Array.from(set);
  }, [cityToLogs, cityToWishes]);

  const linePairs = useMemo(() => {
    const pairs: [string, string][] = [];
    for (let i = 0; i < INITIAL_MAP_CITIES.length - 1; i++) {
      pairs.push([INITIAL_MAP_CITIES[i], INITIAL_MAP_CITIES[i + 1]]);
    }
    return pairs;
  }, []);

  const showTooltip = useCallback(
    (city: string, e: React.MouseEvent) => {
      const logs = cityToLogs.get(city) ?? [];
      const wishes = cityToWishes.get(city) ?? [];
      setTooltip({
        clientX: e.clientX,
        clientY: e.clientY,
        city,
        logs,
        wishes,
      });
    },
    [cityToLogs, cityToWishes],
  );

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  /** 省会中已有坐标的（用于标注）；点亮城市单独在下方渲染，这里只标未点亮的省会 */
  const capitalsWithCoords = useMemo(
    () =>
      CAPITAL_CITIES.filter(
        (c) => CITY_COORDS[c] && !allCities.includes(c),
      ),
    [allCities],
  );

  return (
    <div
      className={cn("relative rounded-2xl border bg-card overflow-hidden font-map", props.className)}
      onMouseLeave={hideTooltip}
    >
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          center: [119, 31],
          scale: 900,
        }}
        className="w-full aspect-[4/3]"
      >
        <ZoomableGroup center={[119, 31]} zoom={1.3} minZoom={0.8} maxZoom={4}>
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              (geographies as GeographyGeom[])
                .filter((g) => String(g.id ?? (g.properties as { id?: unknown }).id) === CHINA_ID)
                .map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo as GeographyGeom}
                    fill={MAP_FILL}
                    stroke={MAP_STROKE}
                    strokeWidth={0.6}
                    style={geographyStyle}
                  />
                ))
            }
          </Geographies>

          {/* 点亮城市：底层加深色圆 */}
          {allCities.map((city) => {
            const coords = CITY_COORDS[city];
            if (!coords) return null;
            return (
              <Marker key={`lit-${city}`} coordinates={coords}>
                <circle r={14} fill={MAP_FILL_LIT} opacity={0.85} />
              </Marker>
            );
          })}

          {linePairs.map(([fromCity, toCity]) => {
            const from = CITY_COORDS[fromCity];
            const to = CITY_COORDS[toCity];
            if (!from || !to) return null;
            return (
              <Line
                key={`${fromCity}-${toCity}`}
                from={from}
                to={to}
                stroke={MAP_FILL_LIT}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray="6 4"
                className="animate-map-dash"
              />
            );
          })}

          {/* 省会名（仅文字） */}
          {capitalsWithCoords.map((city) => {
            const coords = CITY_COORDS[city];
            if (!coords) return null;
            const isLit = allCities.includes(city);
            return (
              <Marker key={`cap-${city}`} coordinates={coords}>
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={isLit ? 11 : 9}
                  fill={isLit ? "#1a1a1a" : "rgba(0,0,0,0.6)"}
                  fontWeight={isLit ? 600 : 400}
                  x={0}
                  y={0}
                  className="select-none"
                  style={{ pointerEvents: "none" }}
                >
                  {city}
                </text>
              </Marker>
            );
          })}

          {/* 点亮城市：圆点 + 可点击名称 */}
          {allCities.map((city) => {
            const coords = CITY_COORDS[city];
            if (!coords) return null;
            return (
              <Marker key={city} coordinates={coords}>
                <g
                  className="cursor-pointer"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    showTooltip(city, e);
                  }}
                  onMouseEnter={(e: React.MouseEvent) => showTooltip(city, e)}
                >
                  <circle r={6} fill={MAP_FILL_LIT} stroke="#fff" strokeWidth={2} />
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="#1a1a1a"
                    x={0}
                    y={-16}
                    className="pointer-events-none select-none"
                  >
                    {city}
                  </text>
                </g>
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>

      {tooltip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[9999] min-w-[200px] max-w-[280px] rounded-xl border border-border bg-popover px-3 py-2.5 text-sm shadow-lg"
            style={{
              left: Math.min(tooltip.clientX + 12, window.innerWidth - 220),
              top: Math.min(tooltip.clientY + 12, window.innerHeight - 180),
            }}
          >
            <div className="font-semibold text-foreground">{tooltip.city}</div>
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              {tooltip.logs.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">旅行记录</p>
                  {tooltip.logs.map((log) => (
                    <div key={log.id}>
                      <div>
                        <span className="text-xs text-muted-foreground">日期：</span>
                        <span className="text-xs text-foreground">{log.date}</span>
                      </div>
                      <div className="mt-0.5">
                        <span className="text-xs text-muted-foreground">旅行随笔：</span>
                        <span className="text-xs text-foreground line-clamp-4">
                          {log.note?.trim() || "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {tooltip.wishes.length > 0 ? (
                <div className={cn(tooltip.logs.length > 0 && "border-t border-border pt-2", "space-y-2")}>
                  {tooltip.wishes.map((w) => (
                    <div key={w.id}>
                      <div>
                        <span className="text-xs text-muted-foreground">日期：</span>
                        <span className="text-xs text-foreground">{formatWishCardHeader(w.wishDate)}</span>
                      </div>
                      <div className="mt-0.5">
                        <span className="text-xs text-muted-foreground">旅行随笔：</span>
                        <span className="text-xs text-foreground line-clamp-4">{w.thing?.trim() || "—"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {tooltip.logs.length === 0 && tooltip.wishes.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无记录</p>
              ) : null}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
