package com.lulu.campusmarketbackend.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.ibatis.executor.parameter.ParameterHandler;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 对<b>生产映射语句</b>执行 EXPLAIN。
 *
 * <p>不在测试里手抄一份 SQL：手抄的版本迟早与 ProductMapper.xml 漂移，
 * 到时候测的就不是线上跑的那条语句了。这里从 MyBatis 取出真实的 MappedStatement，
 * 用它自己的 ParameterHandler 绑定参数，前面只加一个 EXPLAIN 前缀。
 */
public final class ExplainSupport {

    private final SqlSessionFactory sessions;
    private final DataSource dataSource;
    private final ObjectMapper json = new ObjectMapper();

    public ExplainSupport(SqlSessionFactory sessions, DataSource dataSource) {
        this.sessions = sessions;
        this.dataSource = dataSource;
    }

    /** 一次 EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) 的结果。 */
    public record Plan(JsonNode root, String sql) {

        public JsonNode top() {
            return root.get(0).path("Plan");
        }

        public double executionMillis() {
            return root.get(0).path("Execution Time").asDouble();
        }

        /** 计划树里出现过的全部节点，深度优先。 */
        public List<JsonNode> nodes() {
            List<JsonNode> result = new ArrayList<>();
            collect(top(), result);
            return result;
        }

        private static void collect(JsonNode node, List<JsonNode> out) {
            out.add(node);
            for (JsonNode child : node.path("Plans")) collect(child, out);
        }

        /** 是否对某张表做了顺序扫描。 */
        public boolean seqScanOn(String relation) {
            return nodes().stream().anyMatch(n ->
                    "Seq Scan".equals(n.path("Node Type").asText())
                            && relation.equals(n.path("Relation Name").asText()));
        }

        /** 计划中用到的索引名。 */
        public List<String> indexesUsed() {
            return nodes().stream()
                    .map(n -> n.path("Index Name").asText(""))
                    .filter(name -> !name.isEmpty())
                    .distinct().toList();
        }

        /** 用于报告的一行摘要：节点类型链与耗时。 */
        public String summary() {
            StringBuilder types = new StringBuilder();
            for (JsonNode n : nodes()) {
                if (!types.isEmpty()) types.append(" > ");
                types.append(n.path("Node Type").asText());
                String index = n.path("Index Name").asText("");
                if (!index.isEmpty()) types.append('[').append(index).append(']');
                String relation = n.path("Relation Name").asText("");
                if (index.isEmpty() && !relation.isEmpty()) types.append('(').append(relation).append(')');
            }
            return String.format("%.2f ms | %s", executionMillis(), types);
        }
    }

    public Plan explain(String statementId, Map<String, Object> params) throws Exception {
        Configuration configuration = sessions.getConfiguration();
        MappedStatement statement = configuration.getMappedStatement(statementId);
        BoundSql bound = statement.getBoundSql(params);
        String sql = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + bound.getSql();

        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(sql)) {
            ParameterHandler handler = configuration.newParameterHandler(statement, params, bound);
            handler.setParameters(ps);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return new Plan(json.readTree(rs.getString(1)), bound.getSql());
            }
        }
    }
}
