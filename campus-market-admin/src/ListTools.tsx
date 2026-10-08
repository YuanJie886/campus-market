import { TopToolbar, FilterButton, SelectColumnsButton, ExportButton, useListContext } from 'react-admin';
import { Box, Button, Typography } from '@mui/material';

export function ListActions({ preferenceKey }: { preferenceKey?: string }) { return <TopToolbar><FilterButton /><SelectColumnsButton preferenceKey={preferenceKey} /><ExportButton maxResults={100} label="导出记录" /></TopToolbar>; }
export function ListSummary() {
    const { total, isPending, filterValues, setFilters } = useListContext();
    return <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>{isPending ? '正在加载…' : `共 ${total ?? 0} 条记录`}</Typography>
        {Object.values(filterValues).some(Boolean) && <Button size="small" onClick={() => setFilters({}, {})}>清除筛选</Button>}
        <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>导出最多 100 条筛选结果</Typography>
    </Box>;
}
