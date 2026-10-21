package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.school.SchoolDirectory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 公开的学校与校区列表（不需要登录，普通信封）：
 * {@code [{"id","name","shortName","campuses":[{"id","name","hasBuildings"}]}]}。见 docs/school-data.md。
 */
@RestController
@RequestMapping("/v1")
public class SchoolController {
    private final SchoolDirectory directory;

    public SchoolController(SchoolDirectory directory) {
        this.directory = directory;
    }

    @GetMapping("/schools")
    public List<Map<String, Object>> schools() {
        return directory.list();
    }
}
