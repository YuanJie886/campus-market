package com.lulu.campusmarketbackend.school;

import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 按 SCHOOL_PACKS 列出的 id 找到数据包文件并校验。
 *
 * <p>查找顺序：先找 SCHOOL_PACKS_DIR/&lt;id&gt;.json（运维挂载的文件，可以覆盖内置版本），
 * 再找 classpath:schools/&lt;id&gt;.json（随应用发布的内置数据包）。都找不到即启动失败。
 */
public final class SchoolPackLoader {
    public static final String CLASSPATH_DIR = "schools/";

    private SchoolPackLoader() {}

    /** 解析逗号分隔的 id 列表：去空白、去空项、保序去重；每个 id 都必须符合 id 规则。 */
    public static List<String> parseIds(String raw) {
        Set<String> ids = new LinkedHashSet<>();
        if (raw == null) return List.of();
        for (String part : raw.split(",")) {
            String id = part.strip();
            if (id.isEmpty()) continue;
            if (!SchoolPackValidator.ID.matcher(id).matches()) {
                throw new SchoolPackException("SCHOOL_PACKS 中的 '" + id + "' 不是合法的学校 id（小写字母、数字、连字符）");
            }
            ids.add(id);
        }
        return List.copyOf(ids);
    }

    public static List<SchoolPack> load(List<String> ids, String packsDir) {
        Path dir = packsDir == null || packsDir.isBlank() ? null : Path.of(packsDir.strip());
        if (dir != null && !Files.isDirectory(dir)) {
            throw new SchoolPackException("SCHOOL_PACKS_DIR '" + dir + "' 不存在或不是目录");
        }
        List<SchoolPack> packs = new ArrayList<>();
        for (String id : ids) packs.add(loadOne(id, dir));
        SchoolPackValidator.validateTogether(packs);
        return List.copyOf(packs);
    }

    private static SchoolPack loadOne(String id, Path dir) {
        String file = id + ".json";
        if (dir != null) {
            Path external = dir.resolve(file);
            if (Files.isRegularFile(external)) {
                try {
                    return SchoolPackValidator.parse(external.toString(), Files.readAllBytes(external), id);
                } catch (IOException e) {
                    throw new SchoolPackException("学校数据包 " + external + " 无法读取：" + e.getMessage(), e);
                }
            }
        }
        ClassPathResource resource = new ClassPathResource(CLASSPATH_DIR + file);
        if (resource.exists()) {
            try (InputStream in = resource.getInputStream()) {
                return SchoolPackValidator.parse("classpath:" + CLASSPATH_DIR + file, in.readAllBytes(), id);
            } catch (IOException e) {
                throw new SchoolPackException("学校数据包 classpath:" + CLASSPATH_DIR + file + " 无法读取：" + e.getMessage(), e);
            }
        }
        throw new SchoolPackException("SCHOOL_PACKS 启用了 '" + id + "'，但找不到数据包文件 " + file
                + (dir == null ? "（classpath:" + CLASSPATH_DIR + " 下没有；未设置 SCHOOL_PACKS_DIR）"
                        : "（" + dir + " 与 classpath:" + CLASSPATH_DIR + " 下都没有）"));
    }
}
