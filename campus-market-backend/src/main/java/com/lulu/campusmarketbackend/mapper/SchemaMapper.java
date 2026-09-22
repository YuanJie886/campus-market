package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface SchemaMapper {
    @Update("${statement}")
    void execute(@Param("statement") String statement);
}
