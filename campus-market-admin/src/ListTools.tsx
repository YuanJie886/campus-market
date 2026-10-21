import { TopToolbar, FilterButton, SelectColumnsButton, ExportButton, useListContext } from 'react-admin';
import { Box, Button, Typography } from '@mui/material';

/** exportMax：导出条数上限，不能超过该资源的服务端分页上限（默认 100；注册邀请码为 50）。 */
export function ListActions({ preferenceKey, exportMax = 100 }: { preferenceKey?: string; exportMax?: number }) { return <TopToolbar><FilterButton /><SelectColumnsButton preferenceKey={preferenceKey} /><ExportButton maxResults={exportMax} label="导出记录" /></TopToolbar>; }
export function ListSummary({ exportMax = 100 }: { exportMax?: number }) {
    const { total, data, isPending, filterValues, setFilters } = useListContext();
    const rows: number = data?.length ?? 0;
    return <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>{isPending ? '正在加载…' : total == null ? `本页 ${rows} 条记录` : `共 ${total} 条记录`}</Typography>
        {Object.values(filterValues).some(Boolean) && <Button size="small" onClick={() => setFilters({}, {})}>清除筛选</Button>}
        <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>{`导出最多 ${exportMax} 条筛选结果`}</Typography>
    </Box>;
}
