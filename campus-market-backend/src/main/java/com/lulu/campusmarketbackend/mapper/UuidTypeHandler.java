package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.UUID;

@MappedTypes(UUID.class)
@MappedJdbcTypes(JdbcType.OTHER)
public class UuidTypeHandler extends BaseTypeHandler<UUID> {
    @Override public void setNonNullParameter(PreparedStatement ps, int i, UUID parameter, JdbcType jdbcType) throws SQLException { ps.setObject(i, parameter); }
    @Override public UUID getNullableResult(ResultSet rs, String columnName) throws SQLException { return parse(rs.getObject(columnName)); }
    @Override public UUID getNullableResult(ResultSet rs, int columnIndex) throws SQLException { return parse(rs.getObject(columnIndex)); }
    @Override public UUID getNullableResult(CallableStatement cs, int columnIndex) throws SQLException { return parse(cs.getObject(columnIndex)); }
    private UUID parse(Object value) { return value == null ? null : value instanceof UUID uuid ? uuid : UUID.fromString(String.valueOf(value)); }
}
