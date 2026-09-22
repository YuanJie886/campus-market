package com.lulu.campusmarketbackend.mapper;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.List;

public class JsonbTypeHandler extends BaseTypeHandler<List<String>> {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, List<String> parameter, JdbcType jdbcType) throws SQLException {
        ps.setObject(i, write(parameter), Types.OTHER);
    }

    @Override public List<String> getNullableResult(ResultSet rs, String columnName) throws SQLException { return read(rs.getObject(columnName)); }
    @Override public List<String> getNullableResult(ResultSet rs, int columnIndex) throws SQLException { return read(rs.getObject(columnIndex)); }
    @Override public List<String> getNullableResult(CallableStatement cs, int columnIndex) throws SQLException { return read(cs.getObject(columnIndex)); }

    private static String write(List<String> value) throws SQLException {
        try { return MAPPER.writeValueAsString(value == null ? List.of() : value); }
        catch (Exception e) { throw new SQLException("JSON 字段序列化失败", e); }
    }
    private static List<String> read(Object value) throws SQLException {
        if (value == null) return List.of();
        try {
            String json = value.getClass().getName().equals("org.postgresql.util.PGobject")
                    ? String.valueOf(value.getClass().getMethod("getValue").invoke(value)) : String.valueOf(value);
            return MAPPER.readValue(json, new TypeReference<>() {});
        } catch (Exception e) { throw new SQLException("JSON 字段反序列化失败", e); }
    }
}
